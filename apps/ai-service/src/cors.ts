import type { Db } from "./db.js";

const TTL_MS = 60_000;
const ANY = "*"; // cache key for the union over all assistants

export function createCorsOriginLookup(db: Db, nowMs: () => number = Date.now) {
  const cache = new Map<string, { at: number; origins: string[] }>();
  const cached = async (key: string, load: () => Promise<string[]>) => {
    const hit = cache.get(key);
    if (hit && nowMs() - hit.at < TTL_MS) return hit.origins;
    const origins = await load();
    cache.set(key, { at: nowMs(), origins });
    return origins;
  };
  return {
    allowedOrigins(app: string): Promise<string[]> {
      return cached(app, async () => {
        const rows = await db.query<{ allowed_origins: string[] }>(
          "select allowed_origins from assistants where app = $1",
          [app],
        );
        return rows[0]?.allowed_origins ?? [];
      });
    },
    /** Origins allowed by any assistant: for /v1 routes whose app is only known from the body. */
    anyAllowedOrigins(): Promise<string[]> {
      return cached(ANY, async () => {
        const rows = await db.query<{ origin: string }>(
          "select distinct unnest(allowed_origins) as origin from assistants",
        );
        return rows.map((r) => r.origin);
      });
    },
    invalidate(app: string): void {
      cache.delete(app);
      cache.delete(ANY);
    },
  };
}
