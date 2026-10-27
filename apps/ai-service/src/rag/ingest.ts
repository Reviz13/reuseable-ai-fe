import type { AppId } from "@ai/contracts";
import { withTransaction, type Db } from "../db.js";
import { chunkText, type Chunk } from "./chunker.js";
import type { Embedder } from "./embedder.js";
import { toVectorLiteral } from "./retriever.js";

export interface IngestDeps {
  db: Db;
  embedder: Embedder;
}

export interface IngestInput {
  app: AppId;
  documentId: string;
  versionId: string;
  text: string;
  /** FAQ: keep the whole text as one chunk instead of chunking. */
  singleChunk?: boolean;
}

export const NO_TEXT = "no extractable text";

/** Marks a version failed. A document that already serves an active version keeps serving it. */
export async function markFailed(db: Db, documentId: string, versionId: string, message: string): Promise<void> {
  await withTransaction(db, async (tx) => {
    await tx.query("update document_versions set error = $1 where id = $2", [message, versionId]);
    await tx.query(
      "update documents set status = 'failed' where id = $1 and active_version_id is null",
      [documentId],
    );
  });
}

/**
 * Chunks, embeds (as passages), then writes chunks and flips the document to ready in one transaction.
 * Empty text and unexpected errors mark the version failed; unexpected errors are rethrown.
 */
export async function ingestVersion(deps: IngestDeps, input: IngestInput): Promise<void> {
  const { db, embedder } = deps;
  const { app, documentId, versionId, text } = input;
  try {
    if (!text.trim()) {
      await markFailed(db, documentId, versionId, NO_TEXT);
      return;
    }
    const chunks: Chunk[] = input.singleChunk
      ? [{ ord: 0, content: text, token_count: Math.ceil(text.length / 4) }]
      : chunkText(text);
    if (chunks.length === 0) {
      await markFailed(db, documentId, versionId, NO_TEXT);
      return;
    }
    const vectors = await embedder.embed(
      chunks.map((c) => (c.heading ? `${c.heading}\n${c.content}` : c.content)),
      "passage",
    );
    if (vectors.length !== chunks.length) throw new Error("embedder returned wrong number of vectors");
    await withTransaction(db, async (tx) => {
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i]!;
        await tx.query(
          `insert into chunks (version_id, app, ord, heading, content, embedding, token_count)
           values ($1, $2, $3, $4, $5, $6::vector, $7)`,
          [versionId, app, c.ord, c.heading ?? null, c.content, toVectorLiteral(vectors[i]!), c.token_count],
        );
      }
      await tx.query("update document_versions set embedding_model = $1, error = null where id = $2", [
        embedder.model,
        versionId,
      ]);
      await tx.query("update documents set status = 'ready', active_version_id = $1 where id = $2", [
        versionId,
        documentId,
      ]);
    });
  } catch (err) {
    await markFailed(db, documentId, versionId, err instanceof Error ? err.message : String(err)).catch(
      () => undefined,
    );
    throw err;
  }
}

/** A version still without chunks this long after upload was cut off (S7). */
export const INTERRUPTED_AFTER_MINUTES = 10;
export const INTERRUPTED = "interrupted";

/**
 * S7 startup sweeper: ingestion runs in-process, so a restart mid-ingest leaves versions with no
 * error and no chunks forever. Marks those older than 10 minutes as error 'interrupted'; their
 * documents become failed unless they still serve an active version. Returns the versions marked.
 */
export async function sweepInterruptedVersions(db: Db): Promise<number> {
  return withTransaction(db, async (tx) => {
    const swept = await tx.query<{ id: string; document_id: string }>(
      `update document_versions v set error = $1
        where v.error is null
          and v.created_at < now() - make_interval(mins => $2)
          and not exists (select 1 from chunks c where c.version_id = v.id)
        returning v.id, v.document_id`,
      [INTERRUPTED, INTERRUPTED_AFTER_MINUTES],
    );
    if (swept.length === 0) return 0;
    await tx.query(
      `update documents set status = 'failed' where id = any($1::uuid[]) and active_version_id is null`,
      [[...new Set(swept.map((r) => r.document_id))]],
    );
    return swept.length;
  });
}
