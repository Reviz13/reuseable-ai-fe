import { describe, expect, it, vi } from "vitest";
import { createFakeAdapter } from "../src/llm/fake.js";
import { createGatewayFor, withFallback } from "../src/llm/gateway.js";
import { createClaudeAdapter } from "../src/llm/claude.js";
import { createOpenAICompatAdapter } from "../src/llm/openaiCompat.js";
import { LlmUnavailableError, type LlmAdapter, type LlmChunk, type LlmRequest } from "../src/llm/types.js";

const req = (over: Partial<LlmRequest> = {}): LlmRequest => ({
  model: "m",
  system: "sys",
  messages: [{ role: "user", content: "hi" }],
  tools: [],
  signal: new AbortController().signal,
  ...over,
});

async function collect(it: AsyncIterable<LlmChunk>): Promise<LlmChunk[]> {
  const out: LlmChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
}

function failing(err: Error, before: LlmChunk[] = []): LlmAdapter & { n: number } {
  const a = {
    n: 0,
    async *stream() {
      a.n++;
      for (const c of before) yield c;
      throw err;
    },
  };
  return a;
}

describe("fake adapter", () => {
  it("replays scripts in order and records calls", async () => {
    const f = createFakeAdapter([[{ type: "text", text: "a" }, { type: "end", stop: "end_turn" }], [{ type: "end", stop: "end_turn" }]]);
    expect(await collect(f.stream(req()))).toEqual([{ type: "text", text: "a" }, { type: "end", stop: "end_turn" }]);
    expect(await collect(f.stream(req({ system: "two" })))).toEqual([{ type: "end", stop: "end_turn" }]);
    expect(f.calls).toHaveLength(2);
    expect(f.calls[1]!.system).toBe("two");
    await expect(collect(f.stream(req()))).rejects.toThrow(/fake LLM script exhausted/);
  });

  it("stops and throws AbortError when aborted", async () => {
    const ac = new AbortController();
    const f = createFakeAdapter([[{ type: "text", text: "a" }, { type: "text", text: "b" }]]);
    const got: LlmChunk[] = [];
    await expect(
      (async () => {
        for await (const c of f.stream(req({ signal: ac.signal }))) {
          got.push(c);
          ac.abort();
        }
      })(),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(got).toHaveLength(1);
  });
});

describe("withFallback", () => {
  it("retries primary once then uses fallback", async () => {
    const primary = failing(new Error("boom"));
    const fb = createFakeAdapter([[{ type: "text", text: "ok" }, { type: "end", stop: "end_turn" }]]);
    const warn = vi.fn();
    const out = await collect(withFallback(primary, fb, { warn }).stream(req()));
    expect(out[0]).toEqual({ type: "text", text: "ok" });
    expect(primary.n).toBe(2);
    expect(warn).toHaveBeenCalled();
  });

  it("throws LlmUnavailableError when both fail", async () => {
    const p = failing(new Error("p"));
    const f = failing(new Error("f"));
    await expect(collect(withFallback(p, f, { warn: () => {} }).stream(req()))).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(p.n).toBe(2);
    expect(f.n).toBe(1);
  });

  it("throws LlmUnavailableError with no fallback after retry", async () => {
    const p = failing(new Error("p"));
    await expect(collect(withFallback(p, undefined, { warn: () => {} }).stream(req()))).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(p.n).toBe(2);
  });

  it("rethrows errors after the first chunk without fallback", async () => {
    const p = failing(new Error("mid"), [{ type: "text", text: "x" }]);
    const f = createFakeAdapter([[{ type: "text", text: "no" }]]);
    const got: LlmChunk[] = [];
    await expect(
      (async () => {
        for await (const c of withFallback(p, f, { warn: () => {} }).stream(req())) got.push(c);
      })(),
    ).rejects.toThrow("mid");
    expect(got).toEqual([{ type: "text", text: "x" }]);
    expect(p.n).toBe(1);
    expect(f.calls).toHaveLength(0);
  });

  it("never retries abort errors", async () => {
    const ac = new AbortController();
    ac.abort();
    const err = Object.assign(new Error("aborted"), { name: "AbortError" });
    const p = failing(err);
    const f = createFakeAdapter([[{ type: "text", text: "no" }]]);
    await expect(collect(withFallback(p, f, { warn: () => {} }).stream(req({ signal: ac.signal })))).rejects.toBe(err);
    expect(p.n).toBe(1);
    expect(f.calls).toHaveLength(0);
  });

  it("fails over when primary is unavailable", async () => {
    const p = failing(new LlmUnavailableError("no key"));
    const f = createFakeAdapter([[{ type: "text", text: "ok" }]]);
    const out = await collect(withFallback(p, f, { warn: () => {} }).stream(req()));
    expect(out).toEqual([{ type: "text", text: "ok" }]);
  });
});

describe("createGatewayFor", () => {
  it("throws LlmUnavailableError on stream when key is missing, not at construction", async () => {
    const gw = createGatewayFor({ anthropicApiKey: undefined } as never);
    const adapter = gw({ llm_adapter: "claude", fallback_adapter: null });
    await expect(collect(adapter.stream(req()))).rejects.toBeInstanceOf(LlmUnavailableError);
  });
  it("openai_compat without base url is unavailable", async () => {
    const gw = createGatewayFor({} as never);
    await expect(collect(gw({ llm_adapter: "openai_compat", fallback_adapter: null }).stream(req()))).rejects.toBeInstanceOf(LlmUnavailableError);
  });
});

describe("claude adapter", () => {
  it("maps stream events and messages", async () => {
    const calls: unknown[] = [];
    const events = [
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hal" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "o" } },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tu1", name: "get_profit", input: {} } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"period":' } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"this_week"}' } },
      { type: "content_block_stop", index: 1 },
      { type: "message_delta", delta: { stop_reason: "tool_use" } },
      { type: "message_stop" },
    ];
    const client = {
      messages: {
        stream: (body: unknown, opts: unknown) => {
          calls.push({ body, opts });
          return (async function* () {
            for (const e of events) yield e;
          })();
        },
      },
    };
    const adapter = createClaudeAdapter("k", { client: client as never });
    const ac = new AbortController();
    const out = await collect(
      adapter.stream(
        req({
          model: "claude-sonnet-5-5",
          signal: ac.signal,
          tools: [{ name: "get_profit", description: "d", input_schema: { type: "object" } }],
          messages: [
            { role: "user", content: "profit?" },
            { role: "assistant", tool_calls: [{ id: "a", name: "t", args: { x: 1 } }, { id: "b", name: "t", args: {} }] },
            { role: "tool", tool_call_id: "a", content: "r1" },
            { role: "tool", tool_call_id: "b", content: "r2" },
          ],
        }),
      ),
    );
    expect(out).toEqual([
      { type: "text", text: "Hal" },
      { type: "text", text: "o" },
      { type: "tool_call", call: { id: "tu1", name: "get_profit", args: { period: "this_week" } } },
      { type: "end", stop: "tool_use" },
    ]);
    const { body, opts } = calls[0] as { body: any; opts: any };
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.system).toBe("sys");
    expect(body.max_tokens).toBe(1024);
    expect(body.tools).toEqual([{ name: "get_profit", description: "d", input_schema: { type: "object" } }]);
    expect(opts.signal).toBe(ac.signal);
    expect(body.messages).toEqual([
      { role: "user", content: "profit?" },
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "a", name: "t", input: { x: 1 } },
          { type: "tool_use", id: "b", name: "t", input: {} },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "a", content: "r1" },
          { type: "tool_result", tool_use_id: "b", content: "r2" },
        ],
      },
    ]);
  });

  it("empty tool args become {} and end_turn stop", async () => {
    const events = [
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t", name: "n", input: {} } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
    ];
    const client = { messages: { stream: () => (async function* () { for (const e of events) yield e; })() } };
    const out = await collect(createClaudeAdapter("k", { client: client as never }).stream(req()));
    expect(out).toEqual([
      { type: "tool_call", call: { id: "t", name: "n", args: {} } },
      { type: "end", stop: "end_turn" },
    ]);
  });
});

describe("openai-compat adapter", () => {
  it("accumulates split tool_call argument deltas into one tool_call", async () => {
    const sse = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
    const base = { id: "1", object: "chat.completion.chunk", created: 1, model: "m" };
    const body =
      sse({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "Hi" }, finish_reason: null }] }) +
      sse({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "get_profit", arguments: '{"peri' } }] }, finish_reason: null }] }) +
      sse({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: 'od":"this_week"}' } }] }, finish_reason: null }] }) +
      sse({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }) +
      "data: [DONE]\n\n";
    let sent: any;
    const fetchMock = vi.fn(async (_url: unknown, init: any) => {
      sent = JSON.parse(init.body);
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    });
    const adapter = createOpenAICompatAdapter("http://llm.test/v1", "key", { fetch: fetchMock as never });
    const out = await collect(
      adapter.stream(
        req({
          tools: [{ name: "get_profit", description: "d", input_schema: { type: "object" } }],
          messages: [
            { role: "user", content: "q" },
            { role: "assistant", tool_calls: [{ id: "c0", name: "get_profit", args: { period: "today" } }] },
            { role: "tool", tool_call_id: "c0", content: "res" },
          ],
        }),
      ),
    );
    expect(out).toEqual([
      { type: "text", text: "Hi" },
      { type: "tool_call", call: { id: "call_1", name: "get_profit", args: { period: "this_week" } } },
      { type: "end", stop: "tool_use" },
    ]);
    expect(sent.stream).toBe(true);
    expect(sent.tools).toEqual([{ type: "function", function: { name: "get_profit", description: "d", parameters: { type: "object" } } }]);
    expect(sent.messages[0]).toEqual({ role: "system", content: "sys" });
    expect(sent.messages[2]).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [{ id: "c0", type: "function", function: { name: "get_profit", arguments: '{"period":"today"}' } }],
    });
    expect(sent.messages[3]).toEqual({ role: "tool", tool_call_id: "c0", content: "res" });
  });
});
