import type { AppId } from "@ai/contracts";
import type { Db } from "../db.js";
import type { Embedder } from "./embedder.js";

export interface RetrievedChunk {
  chunk_id: string;
  document_id: string;
  title: string;
  heading: string | null;
  content: string;
  version: number;
  score: number;
}

/** pgvector text literal, e.g. `[0.1,0.2]`. */
export function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

export function createRetriever(
  db: Db,
  embedder: Embedder,
): (app: AppId, question: string, k: number, minScore: number) => Promise<RetrievedChunk[]> {
  return async (app, question, k, minScore) => {
    const [vec] = await embedder.embed([question], "query");
    if (!vec) return [];
    const rows = await db.query<RetrievedChunk>(
      "select * from match_chunks($1, $2::vector, $3, $4)",
      [app, toVectorLiteral(vec), k, minScore],
    );
    return rows.map((r) => ({
      chunk_id: r.chunk_id,
      document_id: r.document_id,
      title: r.title,
      heading: r.heading ?? null,
      content: r.content,
      version: Number(r.version),
      score: Number(r.score),
    }));
  };
}
