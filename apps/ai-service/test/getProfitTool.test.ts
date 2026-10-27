import { describe, expect, it, vi } from "vitest";
import type { JwtClaims, ProfitReport } from "@ai/contracts";
import { getProfitTool } from "../src/profit/getProfitTool.js";
import { createPosAdapter, UpstreamError, type PosAdapter } from "../src/profit/posAdapter.js";
import type { AuditEntry } from "../src/audit.js";
import { toJsonSchema, toolsFor } from "../src/tools/registry.js";

const report: ProfitReport = {
  sales: 4250000,
  cogs: 1700000,
  profit: 2550000,
  transactions: 312,
  missing_cost_items: 0,
  currency: "IDR",
  from: "2026-10-26",
  to: "2026-10-27",
  as_of: "2026-10-27T05:00:00.000Z",
};
const claims = (role: string): JwtClaims => ({
  iss: "pos",
  aud: "ai-platform",
  sub: "u-1",
  outlet_id: "o-1",
  role,
  tz: "Asia/Jakarta",
  exp: 0,
  jti: "j",
});
const NOW = new Date("2026-10-27T05:00:00Z");

function setup(role: string, getProfit: PosAdapter["getProfit"]) {
  const audits: AuditEntry[] = [];
  const pos = { getProfit: vi.fn(getProfit) };
  const ctx = {
    claims: claims(role),
    now: NOW,
    signal: new AbortController().signal,
    audit: async (e: AuditEntry) => void audits.push(e),
    pos,
  };
  return { audits, pos, ctx };
}

describe("get_profit tool", () => {
  it("owner this_week passes the report through and audits ok", async () => {
    const { audits, pos, ctx } = setup("owner", async () => report);
    const r = await getProfitTool.run({ period: "this_week" }, ctx);
    expect(r).toEqual({ ok: true, data: { report, label: "minggu ini" } });
    expect(pos.getProfit).toHaveBeenCalledWith("o-1", "2026-10-26", "2026-10-27", ctx.signal);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      app: "pos",
      actor_type: "end_user",
      actor_id: "u-1",
      outlet_id: "o-1",
      action: "tool.get_profit",
      params: { period: "this_week", from: "2026-10-26", to: "2026-10-27" },
      outcome: "ok",
    });
  });

  it("cashier is forbidden, POS not called", async () => {
    const { audits, pos, ctx } = setup("cashier", async () => report);
    const r = await getProfitTool.run({ period: "today" }, ctx);
    expect(r).toEqual({ ok: false, code: "FORBIDDEN", message: "Hanya owner yang dapat melihat profit." });
    expect(pos.getProfit).not.toHaveBeenCalled();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ outcome: "forbidden", params: { period: "today", from: null, to: null } });
  });

  it("custom 93 days is INVALID_PERIOD", async () => {
    const { audits, pos, ctx } = setup("owner", async () => report);
    const r = await getProfitTool.run({ period: "custom", start_date: "2026-07-26", end_date: "2026-10-26" }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_PERIOD");
    expect(pos.getProfit).not.toHaveBeenCalled();
    expect(audits[0]).toMatchObject({
      outcome: "error",
      error_code: "INVALID_PERIOD",
      params: { period: "custom", from: null, to: null },
    });
  });

  it("maps UpstreamError to UPSTREAM_ERROR with fixed copy", async () => {
    const { audits, ctx } = setup("owner", async () => {
      throw new UpstreamError("down");
    });
    const r = await getProfitTool.run({ period: "today" }, ctx);
    expect(r).toEqual({
      ok: false,
      code: "UPSTREAM_ERROR",
      message: "Data profit sedang tidak bisa diambil, coba lagi sebentar.",
    });
    expect(audits[0]).toMatchObject({
      outcome: "error",
      error_code: "UPSTREAM_ERROR",
      params: { from: "2026-10-27", to: "2026-10-27" },
    });
  });

  it("propagates abort instead of reporting UPSTREAM_ERROR", async () => {
    const { ctx } = setup("owner", async () => {
      throw new DOMException("aborted", "AbortError");
    });
    await expect(getProfitTool.run({ period: "today" }, ctx)).rejects.toThrow();
  });

  it("parent-signal abort during the POS call is audited ABORTED, then rethrown (Ruling 15)", async () => {
    const ac = new AbortController();
    const { audits, ctx } = setup("owner", async () => {
      ac.abort();
      throw new DOMException("aborted", "AbortError");
    });
    await expect(getProfitTool.run({ period: "today" }, { ...ctx, signal: ac.signal })).rejects.toThrow();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      outcome: "error",
      error_code: "ABORTED",
      params: { period: "today", from: "2026-10-27", to: "2026-10-27" },
    });
  });

  it("tool JSON schema exposes no outlet_id/user_id/role", () => {
    const spec = toJsonSchema(getProfitTool);
    expect(spec.name).toBe("get_profit");
    const props = Object.keys((spec.input_schema as { properties: object }).properties);
    expect(props).toContain("period");
    for (const k of ["outlet_id", "user_id", "role"]) expect(props).not.toContain(k);
  });

  it("registry", () => {
    expect(toolsFor("pos").map((t) => t.name)).toEqual(["get_profit"]);
    expect(toolsFor("banking")).toEqual([]);
    expect(toolsFor("erp")).toEqual([]);
  });
});

describe("pos adapter", () => {
  const ok = () => new Response(JSON.stringify(report), { status: 200 });
  const mk = (f: unknown, timeoutMs = 50) =>
    createPosAdapter({ baseUrl: "http://pos", internalKey: "k", fetch: f as typeof fetch, timeoutMs });
  const hang = (_u: string, init: RequestInit) =>
    new Promise<Response>((_, rej) => init.signal!.addEventListener("abort", () => rej(init.signal!.reason)));

  it("sends key and query, returns report", async () => {
    const f = vi.fn(async () => ok());
    expect(await mk(f).getProfit("o 1", "2026-10-01", "2026-10-02")).toEqual(report);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://pos/internal/reports/profit?outlet_id=o+1&from=2026-10-01&to=2026-10-02");
    expect((init.headers as Record<string, string>)["x-internal-key"]).toBe("k");
  });

  it("fails once then succeeds (5xx retried)", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response("x", { status: 503 })).mockResolvedValueOnce(ok());
    expect(await mk(f).getProfit("o", "a", "b")).toEqual(report);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("fails twice -> UpstreamError after exactly 2 calls", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("network");
    });
    await expect(mk(f).getProfit("o", "a", "b")).rejects.toBeInstanceOf(UpstreamError);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("4xx is not retried", async () => {
    const f = vi.fn(async () => new Response("no", { status: 404 }));
    await expect(mk(f).getProfit("o", "a", "b")).rejects.toBeInstanceOf(UpstreamError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("schema failure is UpstreamError, not retried", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ nope: 1 }), { status: 200 }));
    await expect(mk(f).getProfit("o", "a", "b")).rejects.toBeInstanceOf(UpstreamError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("times out (hanging fetch) then retries", async () => {
    const f = vi.fn(hang);
    await expect(mk(f, 20).getProfit("o", "a", "b")).rejects.toBeInstanceOf(UpstreamError);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("parent abort stops immediately with no retry and is not UpstreamError", async () => {
    const ac = new AbortController();
    const f = vi.fn(hang);
    const p = mk(f, 5000).getProfit("o", "a", "b", ac.signal);
    ac.abort();
    const err = await p.catch((e) => e);
    expect(err).not.toBeInstanceOf(UpstreamError);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
