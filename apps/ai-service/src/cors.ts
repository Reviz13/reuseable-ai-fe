import type { Db } from "./db.js";

const TTL_MS = 60_000;

export function createCorsOriginLookup(db: Db, nowMs: () => number = Date.now) {
  const cache = new Map<string, { at: number; origins: string[] }>();
  return {
    async allowedOrigins(app: string): Promise<string[]> {
      const hit = cache.get(app);
      if (hit && nowMs() - hit.at < TTL_MS) return hit.origins;
      const rows = await db.query<{ allowed_origins: string[] }>(
        "select allowed_origins from assistants where app = $1",
        [app],
      );
      const origins = rows[0]?.allowed_origins ?? [];
      cache.set(app, { at: nowMs(), origins });
      return origins;
    },
    invalidate(app: string): void {
      cache.delete(app);
    },
  };
}
