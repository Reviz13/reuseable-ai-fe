import type { LlmAdapter, LlmChunk, LlmRequest } from "./types.js";

function abortError(): Error {
  const e = new Error("The operation was aborted");
  e.name = "AbortError";
  return e;
}

export function createFakeAdapter(script: LlmChunk[][]): LlmAdapter & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    calls,
    async *stream(req: LlmRequest) {
      const i = calls.length;
      calls.push(req);
      const chunks = script[i];
      if (!chunks) throw new Error(`fake LLM script exhausted (call ${i + 1}, script has ${script.length})`);
      for (const c of chunks) {
        if (req.signal.aborted) throw abortError();
        yield c;
      }
      if (req.signal.aborted) throw abortError();
    },
  };
}

/**
 * Fake LLM script file (LLM_FAKE_SCRIPT, dev/test only). Two formats:
 *
 * - `LlmChunk[][]`: replayed by call index across all requests (createFakeAdapter).
 * - `{ "byUserMessage": { "<message>": LlmChunk[][] } }`: keyed on the last user message of the request;
 *   the round inside a turn is the number of assistant tool-call messages after that user message.
 *   Stateless, so it does not depend on request order, retries or other tests sharing the server.
 *
 * The file is read on every call, so it may be (re)written after the server started (e2e globalSetup).
 */
export type FakeScriptFile = LlmChunk[][] | { byUserMessage: Record<string, LlmChunk[][]> };

export function pickScriptedRound(
  script: { byUserMessage: Record<string, LlmChunk[][]> },
  messages: LlmRequest["messages"],
): LlmChunk[] {
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === "user") {
      lastUser = i;
      break;
    }
  }
  if (lastUser === -1) throw new Error("fake LLM script: request has no user message");
  const message = (messages[lastUser] as { content: string }).content;
  const rounds = script.byUserMessage[message];
  if (!rounds) throw new Error(`fake LLM script: no entry for user message ${JSON.stringify(message)}`);
  const round = messages.slice(lastUser + 1).filter((m) => m.role === "assistant" && "tool_calls" in m).length;
  const chunks = rounds[round];
  if (!chunks) throw new Error(`fake LLM script: ${JSON.stringify(message)} has no round ${round + 1}`);
  return chunks;
}

export function createScriptFileAdapter(path: string, readFile: (p: string) => string): LlmAdapter {
  const byIndex = { n: 0 };
  return {
    async *stream(req: LlmRequest) {
      const script = JSON.parse(readFile(path)) as FakeScriptFile;
      let chunks: LlmChunk[];
      if (Array.isArray(script)) {
        const i = byIndex.n++;
        const c = script[i];
        if (!c) throw new Error(`fake LLM script exhausted (call ${i + 1}, script has ${script.length})`);
        chunks = c;
      } else {
        chunks = pickScriptedRound(script, req.messages);
      }
      for (const c of chunks) {
        if (req.signal.aborted) throw abortError();
        yield c;
      }
      if (req.signal.aborted) throw abortError();
    },
  };
}
