import OpenAI from "openai";
import { parseToolArgs, type LlmAdapter, type LlmChunk, type LlmMessage, type LlmRequest } from "./types.js";

export function toOpenAIMessages(system: string, messages: LlmMessage[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "tool") out.push({ role: "tool", tool_call_id: m.tool_call_id, content: m.content });
    else if ("tool_calls" in m) {
      out.push({
        role: "assistant",
        content: null,
        tool_calls: m.tool_calls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
        })),
      });
    } else out.push({ role: m.role, content: m.content });
  }
  return out;
}

export function createOpenAICompatAdapter(baseUrl: string, apiKey: string, opts: { fetch?: typeof fetch } = {}): LlmAdapter {
  const client = new OpenAI({ baseURL: baseUrl, apiKey, ...(opts.fetch ? { fetch: opts.fetch } : {}), maxRetries: 0 });
  return {
    async *stream(req: LlmRequest): AsyncGenerator<LlmChunk> {
      const stream = await client.chat.completions.create(
        {
          model: req.model,
          stream: true,
          messages: toOpenAIMessages(req.system, req.messages) as never,
          ...(req.tools.length
            ? {
                tools: req.tools.map((t) => ({
                  type: "function" as const,
                  function: { name: t.name, description: t.description, parameters: t.input_schema },
                })),
              }
            : {}),
        },
        { signal: req.signal },
      );
      const calls = new Map<number, { id: string; name: string; args: string }>();
      let finish: string | null = null;
      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.delta?.content) yield { type: "text", text: choice.delta.content };
        for (const tc of choice.delta?.tool_calls ?? []) {
          const cur = calls.get(tc.index) ?? { id: "", name: "", args: "" };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          calls.set(tc.index, cur);
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      }
      for (const [, c] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
        yield { type: "tool_call", call: { id: c.id, name: c.name, args: parseToolArgs(c.args) } };
      }
      yield { type: "end", stop: finish === "tool_calls" || calls.size > 0 ? "tool_use" : "end_turn" };
    },
  };
}
