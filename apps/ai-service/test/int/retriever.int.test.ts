import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "../../src/db.js";
import { createHashEmbedder } from "../../src/rag/embedder.js";
import { createRetriever, toVectorLiteral } from "../../src/rag/retriever.js";
import { createTestDb } from "./pglite.js";

let db: Db;
let pg: PGlite;
let close: () => Promise<void>;
const emb = createHashEmbedder();

beforeAll(async () => {
  ({ db, pg, close } = await createTestDb());
  const [doc] = await db.query<{ id: string }>(
    "insert into documents (app, kind, title, status) values ('pos','file','Panduan Kasir','ready') returning id",
  );
  const [ver] = await db.query<{ id: string }>(
    "insert into document_versions (document_id, version, embedding_model) values ($1, 1, 'hash') returning id",
    [doc!.id],
  );
  await db.query("update documents set active_version_id = $1 where id = $2", [ver!.id, doc!.id]);
  const contents = [
    "Cara membuka kasir: tekan tombol buka kasir lalu masukkan modal awal.",
    "Cara menutup shift: hitung uang tunai dan cetak laporan.",
  ];
  const vecs = await emb.embed(contents, "passage");
  for (let i = 0; i < contents.length; i++) {
    await db.query(
      "insert into chunks (version_id, app, ord, heading, content, embedding, token_count) values ($1,'pos',$2,$3,$4,$5::vector,$6)",
      [ver!.id, i, "Kasir", contents[i], toVectorLiteral(vecs[i]!), Math.ceil(contents[i]!.length / 4)],
    );
  }
});
afterAll(async () => {
  await close();
});

describe("retriever", () => {
  it("formats a pgvector literal", () => {
    expect(toVectorLiteral([1, 0.5, -2])).toBe("[1,0.5,-2]");
  });

  it("returns matching pos chunks, best first, mapped to RetrievedChunk", async () => {
    const r = createRetriever(db, emb);
    const out = await r("pos", "bagaimana cara membuka kasir", 6, 0.1);
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0]).toMatchObject({ title: "Panduan Kasir", heading: "Kasir", version: 1 });
    expect(out[0]!.content).toContain("membuka kasir");
    expect(typeof out[0]!.score).toBe("number");
    expect(out[0]!.chunk_id).toBeTruthy();
    expect(out[0]!.document_id).toBeTruthy();
  });

  it("returns [] for another app", async () => {
    const r = createRetriever(db, emb);
    expect(await r("banking", "bagaimana cara membuka kasir", 6, 0.1)).toEqual([]);
  });

  it("respects min_score", async () => {
    const r = createRetriever(db, emb);
    expect(await r("pos", "bagaimana cara membuka kasir", 6, 0.999)).toEqual([]);
  });
});
