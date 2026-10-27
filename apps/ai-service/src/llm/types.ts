export type LlmToolCall = { id: string; name: string; args: unknown };

export type LlmMessage =
  | { role: "user" | "assistant"; content: string }
  | { role: "assistant"; tool_calls: LlmToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface LlmToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface LlmRequest {
  model: string;
  system: string;
  messages: LlmMessage[];
  tools: LlmToolSpec[];
  signal: AbortSignal;
}

export type LlmChunk =
  | { type: "text"; text: string }
  | { type: "tool_call"; call: LlmToolCall }
  | { type: "end"; stop: "end_turn" | "tool_use" };

export interface LlmAdapter {
  stream(req: LlmRequest): AsyncIterable<LlmChunk>;
}

export class LlmUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LlmUnavailableError";
  }
}

export function parseToolArgs(raw: string): unknown {
  return raw.trim() === "" ? {} : JSON.parse(raw);
}
