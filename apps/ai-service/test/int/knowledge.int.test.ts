import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "../../src/app.js";
import { createMemoryBlobStore } from "../../src/blob.js";
import { createHashEmbedder } from "../../src/rag/embedder.js";
import { createRetriever } from "../../src/rag/retriever.js";
import { createTestDb } from "./pglite.js";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (n: string) => readFileSync(join(here, "../fixtures", n));
const ADMIN = "11111111-1111-1111-1111-111111111111";
const NOPOS = "33333333-3333-3333-3333-333333333333";
const MD = "text/markdown";

let h: Awaited<ReturnType<typeof createTestDb>>;
let app: FastifyInstance;
const emb = createHashEmbedder();

beforeAll(async () => {
  h = await createTestDb();
  await h.pg.exec(`insert into auth.users (id, email) values ('${ADMIN}','a@x'),('${NOPOS}','n@x');`);
  app = createApp({
    config: {} as never,
    db: h.db,
    blob: createMemoryBlobStore(),
    verifyEndUser: async () => {
      throw new Error("unused");
    },
    verifyAdmin: async (t) => {
      if (t === "admin") return { user_id: ADMIN, apps: ["pos"] };
      return { user_id: NOPOS, apps: ["banking"] };
    },
    now: () => new Date(),
    embedder: emb,
  });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await h.close();
});

function multipart(filename: string, buf: Buffer, contentType: string) {
  const b = "----testboundary";
  const head = Buffer.from(
    `--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${b}--\r\n`);
  return { payload: Buffer.concat([head, buf, tail]), headers: { "content-type": `multipart/form-data; boundary=${b}` } };
}

async function upload(filename: string, buf: Buffer, contentType: string, query = "", token = "admin") {
  const m = multipart(filename, buf, contentType);
  return app.inject({
    method: "POST",
    url: `/admin/pos/documents${query}`,
    headers: { ...m.headers, authorization: `Bearer ${token}` },
    payload: m.payload,
  });
}
const get = (url: string) => app.inject({ method: "GET", url, headers: { authorization: "Bearer admin" } });
const send = (method: "POST" | "PUT" | "DELETE", url: string, payload?: object, token = "admin") =>
  app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload });

async function waitDone(id: string) {
  for (let i = 0; i < 100; i++) {
    const r = await get(`/admin/pos/documents/${id}`);
    const d = r.json() as { status: string; active_version_id: string | null; versions: { error: string | null; chunk_count: number }[] };
    if (d.status !== "processing" && d.versions.every((v) => v.error !== null || v.chunk_count > 0)) return d;
    await new Promise((r2) => setTimeout(r2, 50));
  }
  throw new Error("ingest timeout");
}

const search = (q: string) => createRetriever(h.db, emb)("pos", q, 6, 0.1);

describe("knowledge admin api", () => {
  it("uploads an md file, ingests it, and retrieval finds it", async () => {
    const res = await upload("sop-refund.md", fx("sop-refund.md"), MD);
    expect(res.statusCode).toBe(202);
    const { document_id } = res.json() as { document_id: string };
    const doc = (await waitDone(document_id)) as { status: string; active_version_id: string | null };
    expect(doc.status).toBe("ready");
    expect(doc.active_version_id).toBeTruthy();
    const hits = await search("langkah proses refund struk");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.content.toLowerCase()).toContain("refund");
  });

  it("scanned pdf ends failed with 'no extractable text' and zero chunks", async () => {
    const res = await upload("scanned.pdf", fx("scanned.pdf"), "application/pdf");
    expect(res.statusCode).toBe(202);
    const { document_id, version_id } = res.json() as { document_id: string; version_id: string };
    const doc = await waitDone(document_id);
    expect(doc.status).toBe("failed");
    expect(doc.versions[0]!.error).toBe("no extractable text");
    expect(doc.versions[0]!.chunk_count).toBe(0);
    const n = await h.db.query("select 1 from chunks where version_id = $1", [version_id]);
    expect(n).toHaveLength(0);
  });

  it("ingests pdf and docx", async () => {
    const p = await upload("sop-refund.pdf", fx("sop-refund.pdf"), "application/pdf");
    expect(p.statusCode).toBe(202);
    expect((await waitDone((p.json() as { document_id: string }).document_id)).status).toBe("ready");
    const d = await upload(
      "sop.docx",
      fx("sop.docx"),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(d.statusCode).toBe(202);
    expect((await waitDone((d.json() as { document_id: string }).document_id)).status).toBe("ready");
  });

  it("identical re-upload returns 200 with the same version and creates none", async () => {
    const body = Buffer.from("# Dup\n\nisi unik dokumen duplikat");
    const first = await upload("dup.md", body, MD);
    const f = first.json() as { document_id: string; version_id: string };
    await waitDone(f.document_id);
    const second = await upload("dup.md", body, MD);
    expect(second.statusCode).toBe(200);
    expect((second.json() as { version_id: string }).version_id).toBe(f.version_id);
    const doc = (await get(`/admin/pos/documents/${f.document_id}`)).json() as { versions: unknown[] };
    expect(doc.versions).toHaveLength(1);
    const docs = (await get("/admin/pos/documents")).json() as { title: string }[];
    expect(docs.filter((d) => d.title === "dup.md")).toHaveLength(1);
  });

  it("v2 under same document then activate v1 -> retrieval returns v1 only", async () => {
    const r1 = await upload("ver.md", Buffer.from("# Versi\n\nkebijakan zebra satu"), MD);
    const a = r1.json() as { document_id: string; version_id: string };
    await waitDone(a.document_id);
    const r2 = await upload("ver.md", Buffer.from("# Versi\n\nkebijakan giraffe dua"), MD, `?document_id=${a.document_id}`);
    expect(r2.statusCode).toBe(202);
    const b = r2.json() as { document_id: string; version_id: string };
    expect(b.document_id).toBe(a.document_id);
    await waitDone(a.document_id);
    expect((await search("kebijakan giraffe dua")).some((c) => c.content.includes("giraffe"))).toBe(true);

    const act = await send("POST", `/admin/pos/documents/${a.document_id}/activate`, { version_id: a.version_id });
    expect(act.statusCode).toBe(200);
    const hits = await search("kebijakan zebra giraffe");
    const mine = hits.filter((c) => c.document_id === a.document_id);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((c) => c.content.includes("zebra"))).toBe(true);

    const other = await send("POST", `/admin/pos/documents/${a.document_id}/activate`, {
      version_id: "99999999-9999-9999-9999-999999999999",
    });
    expect(other.statusCode).toBe(404);
  });

  it("faq create is retrievable immediately; update replaces", async () => {
    const res = await send("POST", "/admin/pos/faqs", { question: "Jam buka toko?", answer: "Setiap hari pukul 08.00." });
    expect(res.statusCode).toBe(201);
    const { id } = res.json() as { id: string };
    const hits = await search("Jam buka toko?");
    expect(hits[0]!.content).toBe("Q: Jam buka toko?\nA: Setiap hari pukul 08.00.");
    const up = await send("PUT", `/admin/pos/faqs/${id}`, { question: "Jam buka toko?", answer: "Pukul 09.00 saja." });
    expect(up.statusCode).toBe(200);
    const hits2 = await search("Jam buka toko?");
    expect(hits2.filter((c) => c.document_id === id).map((c) => c.content)).toEqual([
      "Q: Jam buka toko?\nA: Pukul 09.00 saja.",
    ]);
  });

  it("delete clears active version, keeps versions, removes from retrieval", async () => {
    const r = await send("POST", "/admin/pos/faqs", { question: "Hapus saya?", answer: "Kolibri unik." });
    const { id } = r.json() as { id: string };
    expect((await search("Hapus saya? Kolibri")).some((c) => c.document_id === id)).toBe(true);
    const del = await send("DELETE", `/admin/pos/documents/${id}`);
    expect(del.statusCode).toBe(200);
    const doc = (await get(`/admin/pos/documents/${id}`)).json() as { active_version_id: unknown; versions: unknown[] };
    expect(doc.active_version_id).toBeNull();
    expect(doc.versions).toHaveLength(1);
    expect((await search("Hapus saya? Kolibri")).some((c) => c.document_id === id)).toBe(false);
  });

  it("list shape and cross-app 404", async () => {
    const [other] = await h.db.query<{ id: string }>(
      "insert into documents (app, kind, title, status) values ('banking','file','x','ready') returning id",
    );
    const list = (await get("/admin/pos/documents")).json() as Record<string, unknown>[];
    expect(list.length).toBeGreaterThan(0);
    expect(Object.keys(list[0]!).sort()).toEqual(
      ["active_version", "active_version_id", "created_at", "id", "kind", "status", "title"].sort(),
    );
    expect(list.some((d) => d.id === other!.id)).toBe(false);
    expect((await get(`/admin/pos/documents/${other!.id}`)).statusCode).toBe(404);
    expect((await send("DELETE", `/admin/pos/documents/${other!.id}`)).statusCode).toBe(404);
  });

  it("rejects disallowed types (415) and oversize (413)", async () => {
    expect((await upload("a.exe", Buffer.from("x"), "application/octet-stream")).statusCode).toBe(415);
    expect((await upload("a.md", Buffer.from("x"), "application/pdf")).statusCode).toBe(415);
    const big = Buffer.alloc(20 * 1024 * 1024 + 10, 97);
    expect((await upload("big.txt", big, "text/plain")).statusCode).toBe(413);
  });

  it("admin without pos is 403 on every route", async () => {
    expect((await upload("n.md", Buffer.from("x"), MD, "", "nopos")).statusCode).toBe(403);
    const list = await app.inject({ method: "GET", url: "/admin/pos/documents", headers: { authorization: "Bearer nopos" } });
    expect(list.statusCode).toBe(403);
    expect((await send("POST", "/admin/pos/faqs", { question: "q", answer: "a" }, "nopos")).statusCode).toBe(403);
  });

  it("writes an audit row per mutation with admin actor", async () => {
    const rows = await h.db.query<{ action: string; actor_type: string; actor_id: string; params: Record<string, unknown> }>(
      "select action, actor_type, actor_id, params from audit_log where app = 'pos'",
    );
    const actions = new Set(rows.map((r) => r.action));
    for (const a of ["doc.upload", "faq.upsert", "doc.activate", "doc.delete"]) expect(actions.has(a)).toBe(true);
    expect(rows.every((r) => r.actor_type === "admin" && r.actor_id === ADMIN)).toBe(true);
    const dup = rows.find((r) => r.action === "doc.upload" && r.params.deduped === true);
    expect(dup).toBeTruthy();
    expect(Object.keys(dup!.params).sort()).toEqual(["checksum", "deduped", "document_id", "title", "version_id"]);
  });
});

describe("review fixes", () => {
  it("malformed bodies return 400 bad_request, not 500", async () => {
    const r = await send("POST", "/admin/pos/faqs", {});
    expect(r.statusCode).toBe(400);
    const j = r.json() as { error: string; issues: { path: unknown; message: string }[] };
    expect(j.error).toBe("bad_request");
    expect(j.issues.length).toBeGreaterThan(0);
    const up = await upload("act.md", Buffer.from("# A\n\nisi activate"), MD);
    const { document_id } = up.json() as { document_id: string };
    await waitDone(document_id);
    expect((await send("POST", `/admin/pos/documents/${document_id}/activate`, {})).statusCode).toBe(400);
    expect((await send("POST", `/admin/pos/documents/${document_id}/activate`, { version_id: "nope" })).statusCode).toBe(400);
  });

  it("failed v2 keeps v1 active and ready (ruling 19); activating it is 409 (ruling 20)", async () => {
    const r1 = await upload("keep.md", Buffer.from("# Keep\n\nkebijakan narwhal tetap"), MD);
    const a = r1.json() as { document_id: string; version_id: string };
    await waitDone(a.document_id);
    const r2 = await upload("scanned.pdf", fx("scanned.pdf"), "application/pdf", `?document_id=${a.document_id}`);
    expect(r2.statusCode).toBe(202);
    const b = r2.json() as { version_id: string };
    const doc = await waitDone(a.document_id);
    expect(doc.status).toBe("ready");
    expect(doc.active_version_id).toBe(a.version_id);
    const v2 = doc.versions.find((v) => (v as { id?: string }).id === b.version_id) as { error: string | null } | undefined;
    expect(v2?.error).toBe("no extractable text");
    expect((await search("kebijakan narwhal tetap")).some((c) => c.document_id === a.document_id && c.content.includes("narwhal"))).toBe(true);
    const act = await send("POST", `/admin/pos/documents/${a.document_id}/activate`, { version_id: b.version_id });
    expect(act.statusCode).toBe(409);
  });

  it("md upload with application/octet-stream is accepted; pdf stays strict", async () => {
    const r = await upload("oct.md", Buffer.from("# Oct\n\nisi octet stream"), "application/octet-stream");
    expect(r.statusCode).toBe(202);
    await waitDone((r.json() as { document_id: string }).document_id);
    expect((await upload("x.pdf", Buffer.from("x"), "application/octet-stream")).statusCode).toBe(415);
  });

  it("cross-app ids are 404 for upload target, activate and faq put", async () => {
    const [d] = await h.db.query<{ id: string }>("insert into documents (app, kind, title, status) values ('banking','file','b','ready') returning id");
    const [f] = await h.db.query<{ id: string }>("insert into documents (app, kind, title, status) values ('banking','faq','bq','ready') returning id");
    const [v] = await h.db.query<{ id: string }>("insert into document_versions (document_id, version) values ($1, 1) returning id", [d!.id]);
    expect((await upload("c.md", Buffer.from("# C\n\nlintas app"), MD, `?document_id=${d!.id}`)).statusCode).toBe(404);
    expect((await send("POST", `/admin/pos/documents/${d!.id}/activate`, { version_id: v!.id })).statusCode).toBe(404);
    expect((await send("PUT", `/admin/pos/faqs/${f!.id}`, { question: "q", answer: "a" })).statusCode).toBe(404);
  });
});
