import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isDevEnv, loadConfig } from "../src/config.js";
import { createScriptFileAdapter, pickScriptedRound } from "../src/llm/fake.js";
import { createGatewayFor } from "../src/llm/gateway.js";
import type { LlmChunk, LlmRequest } from "../src/llm/types.js";

const BASE = {
  APP_ISSUERS: '{"pos":"http://x/jwks"}',
  POS_BASE_URL: "http://p",
  POS_INTERNAL_KEY: "ik",
};

describe("LOCAL_MODE config (Rulings 45/48)", () => {
  const DEV = { ...BASE, NODE_ENV: "development" };
  const FULL = { ...BASE, DATABASE_URL: "postgres://x", SUPABASE_URL: "http://s", SUPABASE_SERVICE_ROLE_KEY: "k" };
  it("relaxes DATABASE_URL / SUPABASE_* in local mode", () => {
    const c = loadConfig({ ...DEV, LOCAL_MODE: "1" });
    expect(c.localMode).toBe(true);
    expect(c.databaseUrl).toBe("");
    expect(c.supabaseUrl).toBe("");
  });
  it("still requires them outside local mode", () => {
    expect(() => loadConfig(BASE)).toThrow(/DATABASE_URL/);
  });
  it.each(["development", "test"])("allows LOCAL_MODE and LLM_FAKE_SCRIPT when NODE_ENV=%s", (NODE_ENV) => {
    const c = loadConfig({ ...BASE, NODE_ENV, LOCAL_MODE: "1", LLM_FAKE_SCRIPT: "x.json" });
    expect(c.localMode).toBe(true);
    expect(c.llmFakeScript).toBe("x.json");
  });
  it.each([undefined, "production", "staging", ""])("refuses LOCAL_MODE when NODE_ENV=%j (Ruling 48: allowlist, fail closed)", (NODE_ENV) => {
    expect(() => loadConfig({ ...BASE, NODE_ENV, LOCAL_MODE: "1" })).toThrow(/NODE_ENV/);
  });
  it.each([undefined, "production"])("refuses LLM_FAKE_SCRIPT when NODE_ENV=%j", (NODE_ENV) => {
    expect(() => loadConfig({ ...FULL, NODE_ENV, LLM_FAKE_SCRIPT: "x.json" })).toThrow(/NODE_ENV/);
  });
  it("a normal config needs no NODE_ENV", () => {
    expect(loadConfig(FULL).localMode).toBe(false);
    expect(loadConfig({ ...FULL, NODE_ENV: "production" }).llmFakeScript).toBeUndefined();
  });
  it("isDevEnv is an allowlist", () => {
    expect(isDevEnv("development")).toBe(true);
    expect(isDevEnv("test")).toBe(true);
    for (const v of [undefined, "", "production", "dev"]) expect(isDevEnv(v)).toBe(false);
  });
});

const call = { type: "tool_call", call: { id: "t1", name: "get_profit", args: { period: "this_week" } } } as const;
const script = {
  byUserMessage: {
    "Profit minggu ini?": [[call, { type: "end", stop: "tool_use" }], [{ type: "text", text: "Rp1.000" }]] as LlmChunk[][],
  },
};

describe("fake script by user message", () => {
  it("picks the round from tool-call messages after the last user message", () => {
    const r1 = pickScriptedRound(script, [
      { role: "user", content: "halo" },
      { role: "assistant", content: "hai" },
      { role: "user", content: "Profit minggu ini?" },
    ]);
    expect(r1[0]).toEqual(call);
    const r2 = pickScriptedRound(script, [
      { role: "user", content: "Profit minggu ini?" },
      { role: "assistant", tool_calls: [call.call] },
      { role: "tool", tool_call_id: "t1", content: "{}" },
    ]);
    expect(r2).toEqual([{ type: "text", text: "Rp1.000" }]);
  });
  it("throws a readable error for an unknown message or missing round", () => {
    expect(() => pickScriptedRound(script, [{ role: "user", content: "x" }])).toThrow(/no entry/);
    expect(() =>
      pickScriptedRound(script, [
        { role: "user", content: "Profit minggu ini?" },
        { role: "assistant", tool_calls: [call.call] },
        { role: "assistant", tool_calls: [call.call] },
      ]),
    ).toThrow(/no round 3/);
  });
  it("gateway returns the file adapter for every assistant, re-reading the file per call", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fake-llm-"));
    const path = join(dir, "s.json");
    writeFileSync(path, JSON.stringify([[{ type: "text", text: "a" }]]));
    const gw = createGatewayFor({ ...loadConfig({ ...BASE, NODE_ENV: "test", LOCAL_MODE: "1" }), llmFakeScript: path });
    const req: LlmRequest = { model: "m", system: "", messages: [{ role: "user", content: "q" }], tools: [], signal: new AbortController().signal };
    const out: LlmChunk[] = [];
    for await (const c of gw({ llm_adapter: "claude", fallback_adapter: null }).stream(req)) out.push(c);
    expect(out).toEqual([{ type: "text", text: "a" }]);
    writeFileSync(path, JSON.stringify(script));
    const adapter = createScriptFileAdapter(path, (p) => readFileSync(p, "utf8"));
    const got: LlmChunk[] = [];
    for await (const c of adapter.stream({ ...req, messages: [{ role: "user", content: "Profit minggu ini?" }] })) got.push(c);
    expect(got[0]).toEqual(call);
  });
});
