import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppIdSchema, FaqInputSchema, type AppId } from "@ai/contracts";
import { createAuditWriter } from "../audit.js";
import { withTransaction, type Db } from "../db.js";
import { DOCX_MIME, extractText } from "../rag/parse.js";
import { ingestVersion } from "../rag/ingest.js";
import { HttpError, parseRequest } from "../http.js";

const BUCKET = "knowledge";
const UuidSchema = z.string().uuid();

const ALLOWED: Record<string, string[]> = {
  ".pdf": ["application/pdf"],
  ".docx": [DOCX_MIME],
  ".md": ["text/markdown", "text/plain"],
  ".txt": ["text/plain"],
};

const notFound = () => new HttpError(404, "not found");

interface DocRow {
  id: string;
  app: string;
  kind: string;
  title: string;
  status: string;
  active_version_id: string | null;
}

async function findDoc(db: Db, app: AppId, id: string): Promise<DocRow> {
  if (!UuidSchema.safeParse(id).success) throw notFound();
  const [doc] = await db.query<DocRow>(
    "select id, app, kind, title, status, active_version_id from documents where id = $1 and app = $2",
    [id, app],
  );
  if (!doc) throw notFound();
  return doc;
}

async function newVersion(db: Db, documentId: string, checksum: string, sourcePath: string | null): Promise<{ id: string; version: number }> {
  const [row] = await db.query<{ id: string; version: number }>(
    `insert into document_versions (document_id, version, checksum, source_path)
     values ($1, (select coalesce(max(version), 0) + 1 from document_versions where document_id = $1), $2, $3)
     returning id, version`,
    [documentId, checksum, sourcePath],
  );
  return row!;
}

function safeName(filename: string): string {
  return filename.replace(/[^\w.\-]+/g, "_") || "file";
}

export function registerKnowledgeRoutes(app: FastifyInstance): void {
  const { deps } = app;
  const db = deps.db;
  const audit = createAuditWriter(db);
  const embedderOrThrow = () => {
    if (!deps.embedder) throw new HttpError(503, "embedder not configured");
    return deps.embedder;
  };

  for (const appId of AppIdSchema.options) {
    const guard = { preHandler: app.requireAdmin(appId) };
    const log = (
      req: { admin: { user_id: string } },
      action: string,
      params: Record<string, unknown>,
      started: number,
    ) =>
      audit({
        app: appId,
        actor_type: "admin",
        actor_id: req.admin.user_id,
        action,
        params,
        outcome: "ok",
        duration_ms: Date.now() - started,
      });

    app.get(`/admin/${appId}/documents`, guard, async () =>
      db.query(
        `select d.id, d.kind, d.title, d.status, d.active_version_id, v.version as active_version, d.created_at
         from documents d left join document_versions v on v.id = d.active_version_id
         where d.app = $1 order by d.created_at desc, d.id`,
        [appId],
      ),
    );

    app.get<{ Params: { id: string } }>(`/admin/${appId}/documents/:id`, guard, async (req) => {
      const doc = await findDoc(db, appId, req.params.id);
      const [meta] = await db.query<{ created_at: string }>("select created_at from documents where id = $1", [doc.id]);
      const [active] = doc.active_version_id
        ? await db.query<{ version: number }>("select version from document_versions where id = $1", [doc.active_version_id])
        : [];
      const versions = await db.query(
        `select v.id, v.version, v.checksum, v.error, v.created_at,
                (select count(*)::int from chunks c where c.version_id = v.id) as chunk_count
         from document_versions v where v.document_id = $1 order by v.version`,
        [doc.id],
      );
      return {
        id: doc.id,
        kind: doc.kind,
        title: doc.title,
        status: doc.status,
        active_version_id: doc.active_version_id,
        active_version: active?.version ?? null,
        created_at: meta!.created_at,
        versions,
      };
    });

    app.post<{ Querystring: { document_id?: string } }>(`/admin/${appId}/documents`, guard, async (req, reply) => {
      const started = Date.now();
      const embedder = embedderOrThrow();
      const part = await req.file();
      if (!part) throw new HttpError(400, "file is required");
      const filename = part.filename.split(/[\\/]/).pop() ?? "";
      const dot = filename.lastIndexOf(".");
      const ext = dot >= 0 ? filename.slice(dot).toLowerCase() : "";
      let mime = part.mimetype.split(";")[0]!.trim().toLowerCase();
      // Windows browsers often send text files as octet-stream or no type: for .md/.txt the extension decides.
      if ((ext === ".md" || ext === ".txt") && (mime === "" || mime === "application/octet-stream")) {
        mime = ext === ".md" ? "text/markdown" : "text/plain";
      }
      if (!ALLOWED[ext]?.includes(mime)) {
        part.file.resume();
        throw new HttpError(415, "unsupported file type");
      }
      const buf = await part.toBuffer(); // throws 413 past the 20 MB limit
      const checksum = createHash("sha256").update(buf).digest("hex");

      const existingId = parseRequest(z.string().uuid().optional(), req.query.document_id);
      let doc: DocRow | undefined;
      if (existingId !== undefined) doc = await findDoc(db, appId, existingId);

      // Same checksum as the active version of the target (or same-titled) document: nothing to do.
      const [dupe] = await db.query<{ document_id: string; version_id: string }>(
        `select d.id as document_id, v.id as version_id
         from documents d join document_versions v on v.id = d.active_version_id
         where d.app = $1 and v.checksum = $2 and ($3::uuid is not null and d.id = $3 or $3::uuid is null and d.kind = 'file' and d.title = $4)
         limit 1`,
        [appId, checksum, doc?.id ?? null, filename],
      );
      if (dupe) {
        await log(req, "doc.upload", { ...dupe, title: doc?.title ?? filename, checksum, deduped: true }, started);
        return reply.code(200).send({ ...dupe, status: "ready", deduped: true });
      }

      const documentId = doc?.id ?? randomUUID();
      let versionId = "";
      await withTransaction(db, async (tx) => {
        if (!doc) {
          await tx.query(
            "insert into documents (id, app, kind, title, status, created_by) values ($1, $2, 'file', $3, 'processing', $4)",
            [documentId, appId, filename, req.admin.user_id],
          );
        }
        const v = await newVersion(tx, documentId, checksum, null);
        versionId = v.id;
        const path = `${appId}/${documentId}/${v.version}/${safeName(filename)}`;
        await deps.blob.put(BUCKET, path, buf, mime);
        await tx.query("update document_versions set source_path = $1 where id = $2", [path, v.id]);
      });

      await log(req, "doc.upload", { document_id: documentId, version_id: versionId, title: doc?.title ?? filename, checksum, deduped: false }, started);

      setImmediate(() => {
        void (async () => {
          try {
            const text = await extractText(buf, mime);
            await ingestVersion({ db, embedder }, { app: appId, documentId, versionId, text });
          } catch (err) {
            // ingestVersion already marked the version failed for its own errors; cover parse errors here.
            try {
              await db.query("update document_versions set error = $1 where id = $2", [
                err instanceof Error ? err.message : String(err),
                versionId,
              ]);
              await db.query("update documents set status = 'failed' where id = $1 and active_version_id is null", [documentId]);
            } catch (inner) {
              app.log.error(inner);
            }
          }
        })();
      });
      return reply.code(202).send({ document_id: documentId, version_id: versionId, status: "processing" });
    });

    const upsertFaq = async (
      req: { admin: { user_id: string }; body: unknown },
      existingId: string | undefined,
      started: number,
    ) => {
      const embedder = embedderOrThrow();
      const input = parseRequest(FaqInputSchema, req.body);
      const text = `Q: ${input.question}\nA: ${input.answer}`;
      const checksum = createHash("sha256").update(text).digest("hex");
      let documentId: string;
      let versionId = "";
      if (existingId !== undefined) {
        const doc = await findDoc(db, appId, existingId);
        if (doc.kind !== "faq") throw notFound();
        documentId = doc.id;
      } else documentId = randomUUID();
      await withTransaction(db, async (tx) => {
        if (existingId === undefined) {
          await tx.query(
            "insert into documents (id, app, kind, title, status, created_by) values ($1, $2, 'faq', $3, 'processing', $4)",
            [documentId, appId, input.question, req.admin.user_id],
          );
        } else {
          await tx.query("update documents set title = $1 where id = $2", [input.question, documentId]);
        }
        versionId = (await newVersion(tx, documentId, checksum, null)).id;
      });
      await ingestVersion({ db, embedder }, { app: appId, documentId, versionId, text, singleChunk: true });
      await log(req, "faq.upsert", { document_id: documentId, version_id: versionId }, started);
      return { id: documentId, version_id: versionId };
    };

    app.post(`/admin/${appId}/faqs`, guard, async (req, reply) => {
      const out = await upsertFaq(req as never, undefined, Date.now());
      return reply.code(201).send(out);
    });
    app.put<{ Params: { id: string } }>(`/admin/${appId}/faqs/:id`, guard, async (req) =>
      upsertFaq(req as never, req.params.id, Date.now()),
    );

    app.post<{ Params: { id: string }; Body: { version_id?: string } }>(
      `/admin/${appId}/documents/:id/activate`,
      guard,
      async (req) => {
        const started = Date.now();
        const doc = await findDoc(db, appId, req.params.id);
        const versionId = parseRequest(z.object({ version_id: z.string().uuid() }), req.body).version_id;
        const [v] = await db.query<{ id: string; error: string | null }>(
          "select id, error from document_versions where id = $1 and document_id = $2",
          [versionId, doc.id],
        );
        if (!v) throw notFound();
        if (v.error) throw new HttpError(409, "version failed ingestion and cannot be activated");
        const [chunks] = await db.query<{ n: number }>("select count(*)::int as n from chunks where version_id = $1", [v.id]);
        if (!chunks || chunks.n === 0) throw new HttpError(409, "version is not ingested yet");
        await db.query("update documents set active_version_id = $1, status = 'ready' where id = $2", [v.id, doc.id]);
        await log(req, "doc.activate", { document_id: doc.id, version_id: v.id }, started);
        return { id: doc.id, active_version_id: v.id };
      },
    );

    app.delete<{ Params: { id: string } }>(`/admin/${appId}/documents/:id`, guard, async (req) => {
      const started = Date.now();
      const doc = await findDoc(db, appId, req.params.id);
      await db.query("update documents set active_version_id = null, status = 'ready' where id = $1", [doc.id]);
      await log(req, "doc.delete", { document_id: doc.id }, started);
      return { id: doc.id, active_version_id: null };
    });
  }
}
