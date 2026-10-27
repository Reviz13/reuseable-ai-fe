import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey, type KeyLike } from "jose";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PublicAssistantSchema, SseEventSchema, type ProfitReport, type SseEvent } from "@ai/contracts";
import { createApp, type AppDeps } from "../../src/app.js";
import { createEndUserVerifier } from "../../src/auth/endUser.js";
import { createMemoryBlobStore } from "../../src/blob.js";
import { NOT_FOUND, RATE_LIMITED, TOO_LONG } from "../../src/copy.js";
import { createFakeAdapter } from "../../src/llm/fake.js";
import { LlmUnavailableError, type LlmAdapter, type LlmChunk, type LlmRequest } from "../../src/llm/types.js";
import { createHashEmbedder } from "../../src/rag/embedder.js";
import { createTestDb } from "./pglite.js";

const ORIGIN = "http://localhost:3000";
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

let h: Awaited<ReturnType<typeof createTestDb>>;
let priv: KeyLike;
let jwks: JWTVerifyGetKey;
const apps: FastifyInstance[] = [];

beforeAll(async () => {
  h = await createTestDb();
  const kp = await generateKeyPair("RS256");
  priv = kp.privateKey;
  jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(kp.publicKey)), alg: "RS256", kid: "k1" }] });
});
afterAll(async () => {
  for (const a of apps) await a.close();
  await h.close();
});

async function token(sub = "u-1", role = "owner", iss = "pos") {
  return new SignJWT({ outlet_id: "o-1", role, tz: "Asia/Jakarta", jti: `j-${Math.random()}` })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(iss)
    .setAudience("ai-platform")
    .setSubject(sub)
    .setExpirationTime(Math.floor(Date.now() / 1000) + 600)
    .sign(priv);
}

/** Answers every request with the same chunks. */
function always(chunks: LlmChunk[]): LlmAdapter & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    calls,
    async *stream(req) {
      calls.push(req);
      for (const c of chunks) yield c;
    },
  };
}

async function makeApp(llm: LlmAdapter, over: Partial<AppDeps> = {}) {
  const app = createApp({
    config: { widgetDir: join(tmpdir(), "no-such-widget-dir-xyz") } as never,
    db: h.db,
    blob: createMemoryBlobStore(),
    verifyEndUser: createEndUserVerifier({ pos: "http://x/jwks", erp: "http://x/jwks" }, { jwksFor: () => jwks }),
    verifyAdmin: async () => {
      throw new Error("unused");
    },
    now: () => new Date("2026-10-27T05:00:00Z"),
    embedder: createHashEmbedder(),
    gatewayFor: () => llm,
    pos: { getProfit: async () => report },
    ...over,
  });
  apps.push(app);
  await app.ready();
  return app;
}

function parseSse(body: string): SseEvent[] {
  return body
    .split("\n\n")
    .filter((b) => b.trim())
    .map((b) => SseEventSchema.parse(JSON.parse(/^data: (.*)$/m.exec(b)![1]!)));
}

async function chat(app: FastifyInstance, body: Record<string, unknown>, tok?: string, headers: Record<string, string> = {}) {
  return app.inject({
    method: "POST",
    url: "/v1/chat",
    headers: { authorization: `Bearer ${tok ?? (await token())}`, ...headers },
    payload: { app: "pos", ...body },
  });
}

const q = <T = Record<string, unknown>>(sql: string, p?: unknown[]) => h.db.query<T>(sql, p);

beforeEach(async () => {
  await h.pg.exec("delete from knowledge_gaps; delete from feedback; delete from messages; delete from conversations;");
});

describe("POST /v1/chat", () => {
  it("streams SSE with CORS headers, persists user+assistant messages and emits done", async () => {
    const llm = createFakeAdapter([
      [{ type: "tool_call", call: { id: "c1", name: "get_profit", args: { period: "this_week" } } }, { type: "end", stop: "tool_use" }],
      [{ type: "text", text: "Profit minggu ini Rp2.550.000." }, { type: "end", stop: "end_turn" }],
    ]);
    const app = await makeApp(llm);
    const res = await chat(app, { message: "  profit minggu ini?  " }, undefined, { origin: ORIGIN });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream");
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.headers["x-accel-buffering"]).toBe("no");
    expect(res.headers["access-control-allow-origin"]).toBe(ORIGIN);

    const events = parseSse(res.body);
    const done = events.at(-1)!;
    expect(done.type).toBe("done");
    expect(events.at(-2)).toEqual({ type: "state", avatar: "happy" });
    if (done.type !== "done") throw new Error();

    const conv = await q<{ app: string; user_id: string; outlet_id: string }>(
      "select app, user_id, outlet_id from conversations where id = $1",
      [done.conversation_id],
    );
    expect(conv[0]).toEqual({ app: "pos", user_id: "u-1", outlet_id: "o-1" });
    const msgs = await q<{ id: string; role: string; content: string; tool_calls: unknown; citations: unknown; guardrail_replaced: boolean; latency_ms: number }>(
      "select * from messages where conversation_id = $1 order by created_at",
      [done.conversation_id],
    );
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs[0]!.content).toBe("profit minggu ini?");
    expect(msgs[1]!.id).toBe(done.message_id);
    expect(msgs[1]!.content).toBe("Profit minggu ini Rp2.550.000.");
    expect(msgs[1]!.tool_calls).toEqual([{ name: "get_profit", args: { period: "this_week" }, ok: true }]);
    expect(msgs[1]!.citations).toEqual([]);
    expect(msgs[1]!.guardrail_replaced).toBe(false);
    expect(msgs[1]!.latency_ms).toBeGreaterThanOrEqual(0);
    const audits = await q("select * from audit_log where action = 'tool.get_profit' and actor_id = 'u-1'");
    expect(audits.length).toBeGreaterThan(0);
  });

  it("replays the last 10 messages oldest first and continues an owned conversation", async () => {
    const llm = always([{ type: "text", text: "ok" }, { type: "end", stop: "end_turn" }]);
    const app = await makeApp(llm);
    const first = parseSse((await chat(app, { message: "m0" })).body).at(-1) as { conversation_id: string };
    for (let i = 1; i < 7; i++) await chat(app, { message: `m${i}`, conversation_id: first.conversation_id });
    const last = llm.calls.at(-1)!;
    // 6 earlier turns = 12 messages; window keeps the last 10, then the new user message.
    expect(last.messages).toHaveLength(11);
    expect(last.messages[0]).toEqual({ role: "user", content: "m1" });
    expect(last.messages.at(-2)).toEqual({ role: "assistant", content: "ok" });
    expect(last.messages.at(-1)).toEqual({ role: "user", content: "m6" });
  });

  it("another user's conversation -> 404 JSON, LLM not called", async () => {
    const llm = always([{ type: "text", text: "ok" }, { type: "end", stop: "end_turn" }]);
    const app = await makeApp(llm);
    const first = parseSse((await chat(app, { message: "hi" })).body).at(-1) as { conversation_id: string };
    const n = llm.calls.length;
    const res = await chat(app, { message: "hi", conversation_id: first.conversation_id }, await token("u-2"));
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(llm.calls.length).toBe(n);
  });

  it("2001-char message -> 400 TOO_LONG copy, LLM never called, nothing persisted", async () => {
    const llm = always([]);
    const app = await makeApp(llm);
    const res = await chat(app, { message: "a".repeat(2001) });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "bad_request", message: TOO_LONG });
    expect(llm.calls).toHaveLength(0);
    expect(await q("select * from messages")).toHaveLength(0);
  });

  it("2000 chars plus surrounding whitespace is accepted", async () => {
    const llm = always([{ type: "text", text: "ok" }, { type: "end", stop: "end_turn" }]);
    const app = await makeApp(llm);
    const res = await chat(app, { message: `  ${"a".repeat(2000)}  ` });
    expect(res.statusCode).toBe(200);
  });

  it("whitespace-only message -> 400 issue list, LLM never called", async () => {
    const llm = always([]);
    const app = await makeApp(llm);
    const res = await chat(app, { message: "   \n " });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "bad_request", issues: [{ path: ["message"], code: "too_small" }] });
    expect(llm.calls).toHaveLength(0);
  });

  it("missing or wrong-app token -> 401 JSON", async () => {
    const app = await makeApp(always([]));
    const res = await app.inject({ method: "POST", url: "/v1/chat", payload: { app: "pos", message: "hi" } });
    expect(res.statusCode).toBe(401);
    const res2 = await chat(app, { message: "hi" }, await token("u-1", "owner", "erp"));
    expect(res2.statusCode).toBe(401);
  });

  it("21st request in a minute for the same app:sub -> 429 with RATE_LIMITED copy; other sub unaffected", async () => {
    const llm = always([{ type: "text", text: "ok" }, { type: "end", stop: "end_turn" }]);
    const app = await makeApp(llm);
    const tok = await token("rl-user");
    for (let i = 0; i < 20; i++) expect((await chat(app, { message: `q${i}` }, tok)).statusCode).toBe(200);
    const res = await chat(app, { message: "q21" }, tok);
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: "rate_limited", message: RATE_LIMITED });
    expect(llm.calls).toHaveLength(20);
    expect((await chat(app, { message: "x" }, await token("rl-other"))).statusCode).toBe(200);
  });

  it("NOT_FOUND answer without tools inserts a knowledge_gaps row", async () => {
    const llm = always([{ type: "text", text: NOT_FOUND }, { type: "end", stop: "end_turn" }]);
    const app = await makeApp(llm);
    const res = await chat(app, { message: "jam buka toko?" });
    const events = parseSse(res.body);
    expect(events.at(-2)).toEqual({ type: "state", avatar: "sad" });
    const gaps = await q<{ app: string; question: string; top_score: number | null }>("select * from knowledge_gaps");
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ app: "pos", question: "jam buka toko?", top_score: null });
  });

  it("LLM unavailable -> error LLM_UNAVAILABLE + state sad, no assistant message", async () => {
    const llm: LlmAdapter = {
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new LlmUnavailableError("down");
      },
    };
    const app = await makeApp(llm);
    const res = await chat(app, { message: "hi" });
    const events = parseSse(res.body);
    expect(events.slice(-2)).toMatchObject([
      { type: "error", code: "LLM_UNAVAILABLE" },
      { type: "state", avatar: "sad" },
    ]);
    expect(events.some((e) => e.type === "done")).toBe(false);
    expect(await q("select * from messages where role = 'assistant'")).toHaveLength(0);
    expect(await q("select * from messages where role = 'user'")).toHaveLength(1);
  });

  it("client disconnect mid-stream aborts the LLM and persists no assistant message", async () => {
    let sawAbort!: (v: boolean) => void;
    const aborted = new Promise<boolean>((r) => (sawAbort = r));
    const llm: LlmAdapter & { calls: LlmRequest[] } = {
      calls: [],
      async *stream(req) {
        llm.calls.push(req);
        yield { type: "text", text: "Satu " };
        await new Promise<void>((resolve) => req.signal.addEventListener("abort", () => resolve(), { once: true }));
        sawAbort(req.signal.aborted);
        const e = new Error("aborted");
        e.name = "AbortError";
        throw e;
      },
    };
    const app = await makeApp(llm);
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;
    const tok = await token("abort-user");
    const body = JSON.stringify({ app: "pos", message: "cerita panjang" });
    const req = http.request({
      host: "127.0.0.1",
      port,
      path: "/v1/chat",
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tok}`, "content-length": Buffer.byteLength(body) },
    });
    req.on("response", (res) => {
      res.on("data", (d: Buffer) => {
        if (d.toString().includes("event: token")) req.destroy();
      });
    });
    req.on("error", () => undefined);
    req.end(body);

    expect(await aborted).toBe(true);
    expect(llm.calls[0]!.signal.aborted).toBe(true);
    await new Promise((r) => setTimeout(r, 100));
    const convs = await q<{ id: string }>("select id from conversations where user_id = 'abort-user'");
    expect(convs).toHaveLength(1);
    const msgs = await q<{ role: string }>("select role from messages where conversation_id = $1", [convs[0]!.id]);
    expect(msgs.map((m) => m.role)).toEqual(["user"]);
  });
});

describe("POST /v1/chat failure paths after setup", () => {
  it("unexpected error after hijack -> error INTERNAL, state sad, response ended, no assistant message", async () => {
    const llm: LlmAdapter = {
      async *stream() {
        yield { type: "text", text: "Sebentar " };
        throw new Error("boom");
      },
    };
    const app = await makeApp(llm);
    const res = await chat(app, { message: "hi" }, await token("internal-user"));
    expect(res.statusCode).toBe(200);
    const events = parseSse(res.body);
    expect(events.slice(-2)).toMatchObject([
      { type: "error", code: "INTERNAL" },
      { type: "state", avatar: "sad" },
    ]);
    expect(events.some((e) => e.type === "done")).toBe(false);
    const rows = await q<{ role: string }>(
      "select m.role from messages m join conversations c on c.id = m.conversation_id where c.user_id = 'internal-user'",
    );
    expect(rows.map((r) => r.role)).toEqual(["user"]);
  });

  it("client disconnect before hijack still aborts: LLM never streams, no assistant message", async () => {
    let releaseAuth!: () => void;
    const authGate = new Promise<void>((r) => (releaseAuth = r));
    let sawRequest!: () => void;
    const requestArrived = new Promise<void>((r) => (sawRequest = r));
    const llm = always([{ type: "text", text: "tidak boleh" }, { type: "end", stop: "end_turn" }]);
    const verify = createEndUserVerifier({ pos: "http://x/jwks" }, { jwksFor: () => jwks });
    const app = await makeApp(llm, {
      verifyEndUser: async (t, a) => {
        sawRequest();
        await authGate; // hold the request before hijack until the client is gone
        return verify(t, a);
      },
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;
    const tok = await token("early-close");
    const body = JSON.stringify({ app: "pos", message: "halo" });
    const req = http.request({
      host: "127.0.0.1",
      port,
      path: "/v1/chat",
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tok}`, "content-length": Buffer.byteLength(body) },
    });
    req.on("error", () => undefined);
    req.end(body);
    await requestArrived;
    req.destroy();
    await new Promise((r) => setTimeout(r, 100));
    releaseAuth();
    await new Promise((r) => setTimeout(r, 300));

    expect(llm.calls.every((c) => c.signal.aborted)).toBe(true);
    const rows = await q<{ role: string }>(
      "select m.role from messages m join conversations c on c.id = m.conversation_id where c.user_id = 'early-close'",
    );
    expect(rows.map((r) => r.role)).not.toContain("assistant");
  });
});

describe("GET /v1/assistants/:app/public", () => {
  it("returns a PublicAssistant with storage URLs (keeping ?v=) and default frames", async () => {
    await q(`update assistants set avatar_frames = '{"idle":"pos/idle.webp?v=3"}'::jsonb where app = 'pos'`);
    const app = await makeApp(always([]));
    const res = await app.inject({ method: "GET", url: "/v1/assistants/pos/public", headers: { origin: ORIGIN, host: "ai.test:4000" } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(ORIGIN);
    const body = PublicAssistantSchema.parse(res.json());
    expect(body).toMatchObject({ app: "pos", name: "Tepi", theme: { accent: "#6d4aff" } });
    expect(body.avatar_frames.idle).toBe("memory://avatars/pos/idle.webp?v=3");
    expect(body.avatar_frames.sad).toBe("http://ai.test:4000/widget/v1/avatar/sad.webp");
    expect(Object.keys(body.avatar_frames).sort()).toEqual(["happy", "idle", "sad", "talking", "thinking"]);
    await q(`update assistants set avatar_frames = '{}'::jsonb where app = 'pos'`);
  });

  it("unknown or unseeded app -> 404", async () => {
    const app = await makeApp(always([]));
    expect((await app.inject({ method: "GET", url: "/v1/assistants/nope/public" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/v1/assistants/erp/public" })).statusCode).toBe(404);
  });
});

describe("POST /v1/feedback", () => {
  async function assistantMessage(app: FastifyInstance, sub = "fb-user") {
    const res = await chat(app, { message: "hi" }, await token(sub));
    return (parseSse(res.body).at(-1) as { message_id: string }).message_id;
  }

  it("upserts feedback for the owner's message", async () => {
    const app = await makeApp(always([{ type: "text", text: "ok" }, { type: "end", stop: "end_turn" }]));
    const id = await assistantMessage(app);
    const tok = await token("fb-user");
    const post = (payload: object) =>
      app.inject({ method: "POST", url: "/v1/feedback", headers: { authorization: `Bearer ${tok}` }, payload: { app: "pos", ...payload } });
    expect((await post({ message_id: id, rating: 1 })).statusCode).toBe(200);
    expect((await post({ message_id: id, rating: -1, comment: "kurang" })).statusCode).toBe(200);
    const rows = await q<{ rating: number; comment: string }>("select rating, comment from feedback where message_id = $1", [id]);
    expect(rows).toEqual([{ rating: -1, comment: "kurang" }]);
  });

  it("someone else's message -> 404; bad rating -> 400", async () => {
    const app = await makeApp(always([{ type: "text", text: "ok" }, { type: "end", stop: "end_turn" }]));
    const id = await assistantMessage(app, "fb-owner");
    const tok = await token("fb-intruder");
    const res = await app.inject({ method: "POST", url: "/v1/feedback", headers: { authorization: `Bearer ${tok}` }, payload: { app: "pos", message_id: id, rating: 1 } });
    expect(res.statusCode).toBe(404);
    const bad = await app.inject({ method: "POST", url: "/v1/feedback", headers: { authorization: `Bearer ${tok}` }, payload: { app: "pos", message_id: id, rating: 5 } });
    expect(bad.statusCode).toBe(400);
    expect(await q("select * from feedback")).toHaveLength(0);
  });
});

describe("GET /widget/v1/*", () => {
  it("serves widgetDir with cache-control and open CORS when the dir exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "widget-"));
    mkdirSync(join(dir, "avatar"));
    writeFileSync(join(dir, "widget.js"), "console.log('w')");
    const app = await makeApp(always([]), { config: { widgetDir: dir } as never });
    const res = await app.inject({ method: "GET", url: "/widget/v1/widget.js", headers: { origin: "https://anywhere.example" } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("console.log");
    expect(res.headers["cache-control"]).toBe("public, max-age=300");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("is skipped when the dir does not exist", async () => {
    const app = await makeApp(always([]));
    expect((await app.inject({ method: "GET", url: "/widget/v1/widget.js" })).statusCode).toBe(404);
  });
});
