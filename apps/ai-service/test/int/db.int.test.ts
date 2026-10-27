import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "../../src/db.js";
import { createTestDb } from "./pglite.js";

let db: Db;
let pg: PGlite;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, pg, close } = await createTestDb());
});
afterAll(async () => {
  await close();
});

const vec = (x: number): string => `[${Array.from({ length: 384 }, (_, i) => (i === 0 ? x : 0.1)).join(",")}]`;

async function seedDoc(
  app: string,
  versions: number[],
  activeVersion: number,
  e: string,
  status = "ready",
): Promise<void> {
  const [doc] = await db.query<{ id: string }>(
    "insert into documents (app, kind, title, status) values ($1, 'file', $2, $3) returning id",
    [app, `${app}-doc`, status],
  );
  for (const v of versions) {
    const [ver] = await db.query<{ id: string }>(
      "insert into document_versions (document_id, version, checksum) values ($1, $2, $3) returning id",
      [doc!.id, v, `ck-${app}-${v}`],
    );
    await db.query(
      "insert into chunks (version_id, app, ord, heading, content, embedding, token_count) values ($1, $2, 0, 'H', $3, $4::vector, 5)",
      [ver!.id, app, `${app}-v${v}`, e],
    );
    if (v === activeVersion) {
      await db.query("update documents set active_version_id = $1 where id = $2", [ver!.id, doc!.id]);
    }
  }
}

describe("db", () => {
  it("anon cannot select assistants", async () => {
    await pg.exec("begin; set local role anon;");
    try {
      const res = await pg.query("select * from assistants");
      expect(res.rows).toHaveLength(0);
    } catch (err) {
      expect(String(err)).toMatch(/permission denied/);
    } finally {
      await pg.exec("rollback");
    }
    const [row] = await db.query<{ n: number }>("select count(*)::int n from assistants");
    expect(row!.n).toBe(1);
  });

  it("seeds the pos assistant", async () => {
    const [a] = await db.query<{ name: string; min_score: number; allowed_origins: string[] }>(
      "select name, min_score, allowed_origins from assistants where app = 'pos'",
    );
    expect(a).toMatchObject({ name: "Tepi", min_score: 0.78, allowed_origins: ["http://localhost:3000"] });
  });

  it("match_chunks isolates apps", async () => {
    const e = vec(0.5);
    await seedDoc("pos", [1], 1, e);
    await seedDoc("banking", [1], 1, e);
    const rows = await db.query<{ content: string }>("select * from match_chunks($1, $2::vector, 6, 0)", ["pos", e]);
    expect(rows.map((r) => r.content)).toEqual(["pos-v1"]);
  });

  it("match_chunks ignores inactive versions", async () => {
    const e = vec(0.9);
    await seedDoc("erp", [1, 2], 2, e);
    const rows = await db.query<{ content: string; version: number; score: number }>(
      "select * from match_chunks($1, $2::vector, 6, 0)",
      ["erp", e],
    );
    expect(rows.map((r) => r.content)).toEqual(["erp-v2"]);
    expect(rows[0]!.version).toBe(2);
    expect(rows[0]!.score).toBeGreaterThan(0.99);
  });

  it("match_chunks applies min_score", async () => {
    await seedDoc("minscore", [1], 1, vec(0.5));
    const q = `[${Array.from({ length: 384 }, (_, i) => (i === 0 ? 0.1 : -0.5)).join(",")}]`;
    const all = await db.query("select * from match_chunks($1, $2::vector, 6, -1)", ["minscore", q]);
    expect(all).toHaveLength(1);
    const none = await db.query("select * from match_chunks($1, $2::vector, 6, 0.999)", ["minscore", q]);
    expect(none).toHaveLength(0);
  });

  it("match_chunks excludes documents that are not ready", async () => {
    const e = vec(0.3);
    await seedDoc("notready", [1], 1, e, "processing");
    const rows = await db.query("select * from match_chunks($1, $2::vector, 6, 0)", ["notready", e]);
    expect(rows).toHaveLength(0);
  });

  it("audit_log update fails", async () => {
    await db.query("insert into audit_log (app, actor_type, action, outcome) values ('pos','end_user','report.profit','ok')");
    await pg.exec("begin; set local role service_role;");
    let msg = "";
    try {
      await pg.query("update audit_log set outcome = 'error'");
    } catch (err) {
      msg = String(err);
    } finally {
      await pg.exec("rollback");
    }
    expect(msg).toMatch(/permission denied/);
  });

  it("audit_log update and delete fail even for the table owner (trigger)", async () => {
    await expect(db.query("update audit_log set outcome = 'error'")).rejects.toThrow(/append-only/);
    await expect(db.query("delete from audit_log")).rejects.toThrow(/append-only/);
  });

  it("functions pin search_path", async () => {
    const rows = await db.query<{ proname: string; proconfig: string[] | null }>(
      "select proname, proconfig from pg_proc where proname in ('match_chunks','audit_log_append_only')",
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.proconfig ?? [], r.proname).toContain("search_path=public, pg_temp");
    }
  });

  it("deleting a conversation cascades to messages", async () => {
    const [c] = await db.query<{ id: string }>("insert into conversations (app, user_id) values ('pos','u1') returning id");
    await db.query("insert into messages (conversation_id, role, content) values ($1,'user','hi')", [c!.id]);
    await db.query("delete from conversations where id = $1", [c!.id]);
    const [n] = await db.query<{ n: number }>("select count(*)::int n from messages where conversation_id = $1", [c!.id]);
    expect(n!.n).toBe(0);
  });
});
