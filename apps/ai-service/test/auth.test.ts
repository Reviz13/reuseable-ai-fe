import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet, type JWTVerifyGetKey, type KeyLike } from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createEndUserVerifier } from "../src/auth/endUser.js";
import { AuthError } from "../src/auth/errors.js";
import { createApp } from "../src/app.js";
import { createMemoryBlobStore } from "../src/blob.js";
import { createCorsOriginLookup } from "../src/cors.js";
import { loadConfig } from "../src/config.js";

let priv: KeyLike;
let jwks: JWTVerifyGetKey;

beforeAll(async () => {
  const kp = await generateKeyPair("RS256");
  priv = kp.privateKey;
  const jwk = { ...(await exportJWK(kp.publicKey)), alg: "RS256", kid: "k1" };
  jwks = createLocalJWKSet({ keys: [jwk] });
});

const claims = { outlet_id: "o1", role: "owner", tz: "Asia/Jakarta" };
async function sign(opts: { iss?: string; expOffsetSec?: number } = {}) {
  const exp = Math.floor(Date.now() / 1000) + (opts.expOffsetSec ?? 600);
  return new SignJWT({ ...claims, jti: "j1" })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(opts.iss ?? "pos")
    .setAudience("ai-platform")
    .setSubject("u1")
    .setExpirationTime(exp)
    .sign(priv);
}
const verify = createEndUserVerifier({ pos: "http://x/jwks" }, { jwksFor: () => jwks });

describe("end user verifier", () => {
  it("accepts valid token", async () => {
    const c = await verify(await sign(), "pos");
    expect(c).toMatchObject({ iss: "pos", sub: "u1", outlet_id: "o1", role: "owner", tz: "Asia/Jakarta" });
  });
  it("rejects wrong issuer", async () => {
    await expect(verify(await sign({ iss: "banking" }), "pos")).rejects.toBeInstanceOf(AuthError);
  });
  it("rejects expired by 31s", async () => {
    await expect(verify(await sign({ expOffsetSec: -31 }), "pos")).rejects.toBeInstanceOf(AuthError);
  });
  it("accepts expired by 20s", async () => {
    await expect(verify(await sign({ expOffsetSec: -20 }), "pos")).resolves.toBeDefined();
  });
  it("rejects garbage and unknown app", async () => {
    await expect(verify("nope", "pos")).rejects.toBeInstanceOf(AuthError);
    await expect(verify(await sign(), "erp")).rejects.toBeInstanceOf(AuthError);
  });
});

const config = loadConfig({
  DATABASE_URL: "postgres://x",
  SUPABASE_URL: "http://s",
  SUPABASE_SERVICE_ROLE_KEY: "k",
  APP_ISSUERS: '{"pos":"http://x/jwks"}',
  POS_BASE_URL: "http://p",
  POS_INTERNAL_KEY: "ik",
});

function makeApp(over: Record<string, unknown> = {}) {
  return createApp({
    config,
    db: { query: async () => [] },
    blob: createMemoryBlobStore(),
    verifyEndUser: verify,
    verifyAdmin: async (t: string) => {
      if (t === "good") return { user_id: "a1", apps: ["pos"] };
      if (t === "other") return { user_id: "a2", apps: ["erp"] };
      throw new AuthError("bad");
    },
    now: () => new Date(),
    ...over,
  } as never);
}

describe("guards", () => {
  it("end user: no header -> 401, valid -> claims set", async () => {
    const app = makeApp();
    app.get("/v1/pos/me", { preHandler: app.requireEndUser("pos") }, async (req) => ({ sub: req.claims.sub }));
    expect((await app.inject({ url: "/v1/pos/me" })).statusCode).toBe(401);
    const r = await app.inject({ url: "/v1/pos/me", headers: { authorization: `Bearer ${await sign()}` } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ sub: "u1" });
    expect((await app.inject({ url: "/v1/pos/me", headers: { authorization: "Bearer junk" } })).statusCode).toBe(401);
  });
  it("admin: 401 without/invalid, 403 for other app, 200 for allowed", async () => {
    const app = makeApp();
    app.get("/admin/pos/x", { preHandler: app.requireAdmin("pos") }, async (req) => req.admin);
    expect((await app.inject({ url: "/admin/pos/x" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/admin/pos/x", headers: { authorization: "Bearer bad" } })).statusCode).toBe(401);
    expect((await app.inject({ url: "/admin/pos/x", headers: { authorization: "Bearer other" } })).statusCode).toBe(403);
    const ok = await app.inject({ url: "/admin/pos/x", headers: { authorization: "Bearer good" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ user_id: "a1", apps: ["pos"] });
  });
  it("healthz", async () => {
    const r = await makeApp().inject({ url: "/healthz" });
    expect(r.json()).toEqual({ ok: true });
  });
  it("CORS: allowed origin echoed on /v1, none on /admin", async () => {
    const db = { query: async () => [{ allowed_origins: ["http://localhost:4100"] }] };
    const app = makeApp({ db });
    app.get("/v1/pos/ping", async () => ({ ok: 1 }));
    app.get("/admin/pos/ping", async () => ({ ok: 1 }));
    const a = await app.inject({ url: "/v1/pos/ping", headers: { origin: "http://localhost:4100" } });
    expect(a.headers["access-control-allow-origin"]).toBe("http://localhost:4100");
    const b = await app.inject({ url: "/v1/pos/ping", headers: { origin: "http://evil.com" } });
    expect(b.headers["access-control-allow-origin"]).toBeUndefined();
    const c = await app.inject({ url: "/admin/pos/ping", headers: { origin: "http://localhost:4100" } });
    expect(c.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("cors lookup cache", () => {
  it("caches 60s and invalidates", async () => {
    const query = vi.fn(async () => [{ allowed_origins: ["http://a"] }]);
    let t = 1000;
    const c = createCorsOriginLookup({ query } as never, () => t);
    expect(await c.allowedOrigins("pos")).toEqual(["http://a"]);
    await c.allowedOrigins("pos");
    expect(query).toHaveBeenCalledTimes(1);
    t += 61_000;
    await c.allowedOrigins("pos");
    expect(query).toHaveBeenCalledTimes(2);
    c.invalidate("pos");
    await c.allowedOrigins("pos");
    expect(query).toHaveBeenCalledTimes(3);
  });
  it("unknown app -> []", async () => {
    const c = createCorsOriginLookup({ query: async () => [] } as never);
    expect(await c.allowedOrigins("pos")).toEqual([]);
  });
});

describe("loadConfig", () => {
  it("defaults and errors readably", () => {
    expect(config.port).toBe(4000);
    expect(config.widgetDir).toBe("../../packages/widget/dist");
    expect(config.appIssuers).toEqual({ pos: "http://x/jwks" });
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });
});
