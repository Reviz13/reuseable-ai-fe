import { describe, it, expect, beforeAll } from "vitest";
import { createLocalJWKSet, jwtVerify, generateKeyPair, exportJWK } from "jose";
import { ProfitReportSchema, JwtClaimsSchema } from "@ai/contracts";
import { dailyTotals } from "../src/data";
import { buildServer } from "../src/server";
import type { Keys } from "../src/keys";

const KEY = "test-internal-key";
const NOW = new Date("2026-10-27T03:00:00.000Z");
let app: ReturnType<typeof buildServer>;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const publicJwk = { ...(await exportJWK(publicKey)), kid: "test-kid", alg: "RS256", use: "sig" };
  const keys: Keys = { privateKey, publicJwk, kid: "test-kid" };
  app = buildServer({ keys, internalKey: KEY, now: () => NOW });
});

const get = (qs: string, headers: Record<string, string> = { "x-internal-key": KEY }) =>
  app.inject({ method: "GET", url: `/internal/reports/profit?${qs}`, headers });

describe("dailyTotals", () => {
  it("is deterministic", () => {
    expect(dailyTotals("kopi-tepi-01", "2026-10-20")).toEqual(dailyTotals("kopi-tepi-01", "2026-10-20"));
  });
  it("has 40-120 transactions", () => {
    const t = dailyTotals("kopi-tepi-01", "2026-10-21").transactions;
    expect(t).toBeGreaterThanOrEqual(40);
    expect(t).toBeLessThanOrEqual(120);
  });
});

describe("GET /internal/reports/profit", () => {
  it("sums the inclusive range", async () => {
    const res = await get("outlet_id=kopi-tepi-01&from=2026-10-20&to=2026-10-26");
    expect(res.statusCode).toBe(200);
    const body = ProfitReportSchema.parse(res.json());
    let sales = 0, cogs = 0, tx = 0, miss = 0;
    for (let d = 20; d <= 26; d++) {
      const t = dailyTotals("kopi-tepi-01", `2026-10-${d}`);
      sales += t.sales; cogs += t.cogs; tx += t.transactions; miss += t.missing_cost_items;
    }
    expect(body).toMatchObject({ sales, cogs, transactions: tx, missing_cost_items: miss, currency: "IDR",
      from: "2026-10-20", to: "2026-10-26", as_of: NOW.toISOString() });
    expect(body.profit).toBe(body.sales - body.cogs);
    expect(body.missing_cost_items).toBeGreaterThan(0);
  });
  it("single day range works", async () => {
    const res = await get("outlet_id=kopi-tepi-01&from=2026-10-20&to=2026-10-20");
    expect(res.json().sales).toBe(dailyTotals("kopi-tepi-01", "2026-10-20").sales);
  });
  it("401 without key", async () => {
    expect((await get("outlet_id=kopi-tepi-01&from=2026-10-20&to=2026-10-26", {})).statusCode).toBe(401);
  });
  it("401 with wrong key", async () => {
    expect((await get("outlet_id=kopi-tepi-01&from=2026-10-20&to=2026-10-26", { "x-internal-key": "x" })).statusCode).toBe(401);
  });
  it("400 when from > to", async () => {
    expect((await get("outlet_id=kopi-tepi-01&from=2026-10-27&to=2026-10-01")).statusCode).toBe(400);
  });
  it("400 on bad / impossible / missing dates", async () => {
    expect((await get("outlet_id=kopi-tepi-01&from=nope&to=2026-10-01")).statusCode).toBe(400);
    expect((await get("outlet_id=kopi-tepi-01&from=2026-02-30&to=2026-03-01")).statusCode).toBe(400);
    expect((await get("outlet_id=kopi-tepi-01&from=2026-10-01")).statusCode).toBe(400);
  });
  it("400 when range exceeds 366 days", async () => {
    expect((await get("outlet_id=kopi-tepi-01&from=2024-01-01&to=2026-01-01")).statusCode).toBe(400);
    expect((await get("outlet_id=kopi-tepi-01&from=2025-10-27&to=2026-10-27")).statusCode).toBe(200);
  });
  it("404 on unknown outlet", async () => {
    expect((await get("outlet_id=nope&from=2026-10-20&to=2026-10-26")).statusCode).toBe(404);
  });
});

describe("token + jwks", () => {
  it("issues a verifiable owner token", async () => {
    const res = await app.inject({ method: "POST", url: "/token", payload: { role: "owner" } });
    expect(res.statusCode).toBe(200);
    const jwks = (await app.inject({ method: "GET", url: "/.well-known/jwks.json" })).json();
    const { payload, protectedHeader } = await jwtVerify(res.body, createLocalJWKSet(jwks), {
      issuer: "pos", audience: "ai-platform", algorithms: ["RS256"], currentDate: NOW,
    });
    expect(protectedHeader.kid).toBe("test-kid");
    const claims = JwtClaimsSchema.parse(payload);
    expect(claims.role).toBe("owner");
    expect(claims).toMatchObject({ sub: "u-owner", outlet_id: "kopi-tepi-01", tz: "Asia/Jakarta" });
    expect(claims.exp).toBe(Math.floor(NOW.getTime() / 1000) + 600);
  });
  it("issues cashier token and rejects unknown role", async () => {
    const ok = await app.inject({ method: "POST", url: "/token", payload: { role: "cashier" } });
    expect(ok.statusCode).toBe(200);
    const bad = await app.inject({ method: "POST", url: "/token", payload: { role: "admin" } });
    expect(bad.statusCode).toBe(400);
  });
});
