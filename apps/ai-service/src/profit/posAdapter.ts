import { ProfitReportSchema, type ProfitReport } from "@ai/contracts";

export class UpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamError";
  }
}

export interface PosAdapter {
  getProfit(outletId: string, from: string, to: string, signal?: AbortSignal): Promise<ProfitReport>;
}

export interface PosAdapterOptions {
  baseUrl: string;
  internalKey: string;
  fetch?: typeof fetch;
  /** Per-attempt timeout in ms (default 5000). */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_ATTEMPTS = 2; // one retry

export function createPosAdapter(opts: PosAdapterOptions): PosAdapter {
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async getProfit(outletId, from, to, signal) {
      const qs = new URLSearchParams({ outlet_id: outletId, from, to });
      const url = `${opts.baseUrl.replace(/\/+$/, "")}/internal/reports/profit?${qs}`;
      let lastErr = "unknown";

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        signal?.throwIfAborted();
        const attemptSignal = signal
          ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs);
        let res: Response;
        try {
          res = await doFetch(url, { headers: { "x-internal-key": opts.internalKey }, signal: attemptSignal });
        } catch (err) {
          if (signal?.aborted) throw signal.reason ?? err; // client disconnect: propagate, no retry
          lastErr = err instanceof Error ? err.message : String(err);
          continue; // timeout or network error: retry
        }
        if (res.status >= 500) {
          lastErr = `POS responded ${res.status}`;
          continue;
        }
        if (!res.ok) throw new UpstreamError(`POS responded ${res.status}`);
        let body: unknown;
        try {
          body = await res.json();
        } catch (err) {
          if (signal?.aborted) throw signal.reason ?? err;
          lastErr = "invalid JSON from POS";
          continue;
        }
        const parsed = ProfitReportSchema.safeParse(body);
        if (!parsed.success) throw new UpstreamError("POS returned an invalid profit report");
        return parsed.data;
      }
      throw new UpstreamError(`POS unavailable: ${lastErr}`);
    },
  };
}
