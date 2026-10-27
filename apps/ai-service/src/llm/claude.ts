import Anthropic from "@anthropic-ai/sdk";
import { parseToolArgs, type LlmAdapter, type LlmChunk, type LlmMessage, type LlmRequest } from "./types.js";

type AnthropicMessage = { role: "user" | "assistant"; content: string | Record<string, unknown>[] };

export interface ClaudeClientLike {
  messages: { stream(body: any, opts?: { signal?: AbortSignal }): AsyncIterable<any> };
}

export function toAnthropicMessages(messages: LlmMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      const block = { type: "tool_result", tool_use_id: m.tool_call_id, content: m.content };
      const last = out[out.length - 1];
      // Anthropic requires all consecutive tool results in a single user message.
      if (last && last.role === "user" && Array.isArray(last.content) && last.content.every((b) => b.type === "tool_result")) {
        last.content.push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
    } else if ("tool_calls" in m) {
      out.push({
        role: "assistant",
        content: m.tool_calls.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.args ?? {} })),
      });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

export function createClaudeAdapter(apiKey: string, opts: { client?: ClaudeClientLike } = {}): LlmAdapter {
  const client: ClaudeClientLike = opts.client ?? (new Anthropic({ apiKey }) as unknown as ClaudeClientLike);
  return {
    async *stream(req: LlmRequest): AsyncGenerator<LlmChunk> {
      const events = client.messages.stream(
        {
          model: req.model,
          system: req.system,
          messages: toAnthropicMessages(req.messages),
          tools: req.tools,
          max_tokens: 1024,
        },
        { signal: req.signal },
      );
      const blocks = new Map<number, { id: string; name: string; json: string }>();
      let stop: "end_turn" | "tool_use" = "end_turn";
      for await (const ev of events) {
        if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use") {
          blocks.set(ev.index, { id: ev.content_block.id, name: ev.content_block.name, json: "" });
        } else if (ev.type === "content_block_delta") {
          if (ev.delta.type === "text_delta") yield { type: "text", text: ev.delta.text };
          else if (ev.delta.type === "input_json_delta") {
            const b = blocks.get(ev.index);
            if (b) b.json += ev.delta.partial_json;
          }
        } else if (ev.type === "content_block_stop") {
          const b = blocks.get(ev.index);
          if (b) {
            blocks.delete(ev.index);
            yield { type: "tool_call", call: { id: b.id, name: b.name, args: parseToolArgs(b.json) } };
          }
        } else if (ev.type === "message_delta" && ev.delta?.stop_reason) {
          stop = ev.delta.stop_reason === "tool_use" ? "tool_use" : "end_turn";
        }
      }
      yield { type: "end", stop };
    },
  };
}
