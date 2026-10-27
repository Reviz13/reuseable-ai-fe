import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sweepInterruptedVersions } from "../../src/rag/ingest.js";
import { createTestDb } from "./pglite.js";

let h: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  h = await createTestDb();
});
afterAll(async () => {
  await h.close();
});

async function doc(id: string, opts: { ageMin: number; chunks?: boolean; active?: boolean; error?: string }) {
  const v = id.replace(/^d/, "e");
  await h.pg.exec(`
    insert into documents (id, app, kind, title, status) values ('${id}', 'pos', 'file', 't', 'processing');
    insert into document_versions (id, document_id, version, error, created_at)
      values ('${v}', '${id}', 1, ${opts.error ? `'${opts.error}'` : "null"}, now() - interval '${opts.ageMin} minutes');
  `);
  if (opts.chunks) {
    const vec = `[${Array(384).fill(0.01).join(",")}]`;
    await h.pg.exec(`insert into chunks (version_id, app, ord, content, embedding, token_count) values ('${v}', 'pos', 0, 'x', '${vec}', 1)`);
  }
  if (opts.active) await h.pg.exec(`update documents set status = 'ready', active_version_id = '${v}' where id = '${id}'`);
  return v;
}

const D = (n: number) => `d0000000-0000-4000-8000-00000000000${n}`;

describe("sweepInterruptedVersions (S7)", () => {
  it("marks stale chunkless versions interrupted and their unserved documents failed", async () => {
    await doc(D(1), { ageMin: 30 }); // stale, no chunks -> interrupted, doc failed
    await doc(D(2), { ageMin: 2 }); // still running -> untouched
    await doc(D(3), { ageMin: 30, chunks: true, active: true }); // ready -> untouched
    await doc(D(4), { ageMin: 30, error: "no extractable text" }); // already failed -> untouched
    const n = await sweepInterruptedVersions(h.db);
    expect(n).toBe(1);
    const rows = await h.db.query<{ id: string; status: string; error: string | null }>(
      `select d.id, d.status, v.error from documents d join document_versions v on v.document_id = d.id order by d.id`,
    );
    expect(rows.map((r) => [r.status, r.error])).toEqual([
      ["failed", "interrupted"],
      ["processing", null],
      ["ready", null],
      ["processing", "no extractable text"],
    ]);
  });
  it("a document still serving an older active version keeps it", async () => {
    const id = D(5);
    await doc(id, { ageMin: 60, chunks: true, active: true });
    await h.pg.exec(`insert into document_versions (id, document_id, version, created_at) values ('v0000000-0000-4000-8000-000000000009', '${id}', 2, now() - interval '30 minutes')`.replace("v0000000", "e0000000"));
    expect(await sweepInterruptedVersions(h.db)).toBe(1);
    const [d] = await h.db.query<{ status: string }>(`select status from documents where id = $1`, [id]);
    expect(d!.status).toBe("ready");
  });
});
