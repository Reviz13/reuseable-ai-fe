import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { Db } from "../../src/db.js";
import { createAuditWriter } from "../../src/audit.js";
import { createTestDb } from "./pglite.js";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => {
  await close();
});

it("writes and reads back an audit row", async () => {
  await createAuditWriter(db)({
    app: "pos",
    actor_type: "end_user",
    actor_id: "u-1",
    outlet_id: "o-1",
    action: "tool.get_profit",
    params: { period: "today", from: "2026-10-27", to: "2026-10-27" },
    outcome: "ok",
    duration_ms: 12,
  });
  const rows = await db.query<Record<string, unknown>>("select * from audit_log where actor_id = 'u-1'");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    app: "pos",
    actor_type: "end_user",
    outlet_id: "o-1",
    action: "tool.get_profit",
    outcome: "ok",
    error_code: null,
    duration_ms: 12,
    params: { period: "today", from: "2026-10-27", to: "2026-10-27" },
  });
});

it("logs and does not throw when the insert fails", async () => {
  const logger = vi.fn();
  const bad: Db = {
    query: async () => {
      throw new Error("boom");
    },
  };
  await expect(
    createAuditWriter(bad, logger)({ app: "pos", actor_type: "end_user", action: "x", params: {}, outcome: "ok", duration_ms: 1 }),
  ).resolves.toBeUndefined();
  expect(logger).toHaveBeenCalled();
});
