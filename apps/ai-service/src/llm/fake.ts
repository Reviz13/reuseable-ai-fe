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
