import { isDevEnv, type Config } from "../config.js";
import { readFileSync } from "node:fs";
import { createClaudeAdapter } from "./claude.js";
import { createScriptFileAdapter } from "./fake.js";
import { createOpenAICompatAdapter } from "./openaiCompat.js";
import { LlmUnavailableError, type LlmAdapter, type LlmChunk, type LlmRequest } from "./types.js";

export type AdapterName = "claude" | "openai_compat";

export interface FallbackLogger {
  warn(message: string, meta?: unknown): void;
}

function isAbort(err: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (err instanceof Error && err.name === "AbortError");
}

/**
 * Failover applies only while nothing has been yielded. After the first chunk of any
 * type, errors propagate unchanged. Aborts are never retried or failed over.
 */
export function withFallback(primary: LlmAdapter, fallback?: LlmAdapter, logger: FallbackLogger = console): LlmAdapter {
  return {
    async *stream(req: LlmRequest): AsyncGenerator<LlmChunk> {
      let lastErr: unknown;
      const plan: [string, LlmAdapter][] = [
        ["primary", primary],
        ["primary-retry", primary],
      ];
      if (fallback) plan.push(["fallback", fallback]);
      let skipRetry = false;
      for (const [label, adapter] of plan) {
        if (label === "primary-retry" && skipRetry) continue;
        let yielded = false;
        try {
          for await (const chunk of adapter.stream(req)) {
            yielded = true;
            yield chunk;
          }
          return;
        } catch (err) {
          if (yielded || isAbort(err, req.signal)) throw err;
          lastErr = err;
          // Misconfiguration (missing key) will not heal on retry.
          if (label === "primary" && err instanceof LlmUnavailableError) skipRetry = true;
          logger.warn(`llm ${label} failed before first chunk: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      throw new LlmUnavailableError("LLM unavailable: all attempts failed", { cause: lastErr });
    },
  };
}

function unavailable(message: string): LlmAdapter {
  return {
    // eslint-disable-next-line require-yield
    async *stream(): AsyncGenerator<LlmChunk> {
      throw new LlmUnavailableError(message);
    },
  };
}

export function createGatewayFor(
  config: Config,
): (assistant: { llm_adapter: AdapterName; fallback_adapter: AdapterName | null }) => LlmAdapter {
  // Test hook (brief Task 15 / Ruling 45): every assistant gets the scripted fake. loadConfig already refuses
  // LLM_FAKE_SCRIPT outside NODE_ENV development/test; checked again here (Ruling 48 allowlist).
  if (config.llmFakeScript && isDevEnv(process.env.NODE_ENV)) {
    const fake = createScriptFileAdapter(config.llmFakeScript, (p) => readFileSync(p, "utf8"));
    return () => fake;
  }
  const cache = new Map<AdapterName, LlmAdapter>();
  const build = (name: AdapterName): LlmAdapter => {
    const hit = cache.get(name);
    if (hit) return hit;
    let adapter: LlmAdapter;
    if (name === "claude") {
      adapter = config.anthropicApiKey
        ? createClaudeAdapter(config.anthropicApiKey)
        : unavailable("ANTHROPIC_API_KEY is not configured for the claude adapter");
    } else {
      adapter =
        config.openaiCompatBaseUrl && config.openaiCompatApiKey
          ? createOpenAICompatAdapter(config.openaiCompatBaseUrl, config.openaiCompatApiKey)
          : unavailable("OPENAI_COMPAT_BASE_URL and OPENAI_COMPAT_API_KEY are not configured for the openai_compat adapter");
    }
    cache.set(name, adapter);
    return adapter;
  };
  return (assistant) =>
    withFallback(build(assistant.llm_adapter), assistant.fallback_adapter ? build(assistant.fallback_adapter) : undefined);
}
