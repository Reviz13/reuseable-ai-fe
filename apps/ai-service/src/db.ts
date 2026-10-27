import { readFileSync } from "node:fs";
import pg from "pg";

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs fn on one dedicated connection inside begin/commit. Absent on single-connection Dbs (PGlite). */
  transaction?<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

const locks = new WeakMap<Db, Promise<unknown>>();

/**
 * Runs fn in a transaction. Uses the Db's own transaction() when present (pg: one pooled client);
 * otherwise plain begin/commit on the single connection, serialised so that two transactions on the
 * same Db never interleave.
 */
export async function withTransaction<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  if (db.transaction) return db.transaction(fn);
  const prev = locks.get(db) ?? Promise.resolve();
  const run = prev.then(async () => {
    await db.query("begin");
    try {
      const out = await fn(db);
      await db.query("commit");
      return out;
    } catch (err) {
      await db.query("rollback").catch(() => undefined);
      throw err;
    }
  });
  locks.set(
    db,
    run.catch(() => undefined),
  );
  return run;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const URL_SSL_PARAMS = ["ssl", "sslmode", "sslcert", "sslkey", "sslrootcert", "sslcrl", "uselibpqcompat"];

/**
 * M3: pg pool options with TLS. Ssl parameters in the URL are dropped, because pg lets them override
 * the `ssl` option. Supabase: use the session pooler URL (the direct db.<ref> host is IPv6-only) and
 * point DATABASE_SSL_CA at the CA certificate from the dashboard (Database settings, SSL).
 * - DATABASE_SSL=disable: no TLS.  DATABASE_SSL=no-verify: TLS without certificate checks.
 * - otherwise localhost/127.0.0.1/::1: no TLS; any other host: verified TLS, with DATABASE_SSL_CA
 *   (a PEM file path) as the trusted CA when set, else the system CAs.
 */
export function pgPoolOptions(
  databaseUrl: string,
  env: { DATABASE_SSL?: string; DATABASE_SSL_CA?: string },
  readFile: (path: string) => string = (p) => readFileSync(p, "utf8"),
): { connectionString: string; ssl?: { rejectUnauthorized: boolean; ca?: string } } {
  const url = new URL(databaseUrl);
  for (const p of URL_SSL_PARAMS) url.searchParams.delete(p);
  const connectionString = url.toString();
  const mode = env.DATABASE_SSL || undefined;
  if (mode !== undefined && mode !== "disable" && mode !== "no-verify") {
    throw new Error(`Invalid configuration: DATABASE_SSL must be "disable" or "no-verify" (got ${JSON.stringify(mode)})`);
  }
  if (mode === "disable") return { connectionString };
  if (mode === "no-verify") return { connectionString, ssl: { rejectUnauthorized: false } };
  if (LOCAL_HOSTS.has(url.hostname)) return { connectionString };
  if (env.DATABASE_SSL_CA) return { connectionString, ssl: { ca: readFile(env.DATABASE_SSL_CA), rejectUnauthorized: true } };
  return { connectionString, ssl: { rejectUnauthorized: true } };
}

export function createPgDb(
  databaseUrl: string,
  env: { DATABASE_SSL?: string; DATABASE_SSL_CA?: string } = {},
): Db & { end(): Promise<void> } {
  const pool = new pg.Pool(pgPoolOptions(databaseUrl, env));
  pool.on("error", (err) => console.error("pg pool idle client error", err));
  return {
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      const res = await pool.query(sql, params as unknown[] | undefined);
      return res.rows as T[];
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      const tx: Db = {
        async query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<R[]> {
          return (await client.query(sql, params as unknown[] | undefined)).rows as R[];
        },
      };
      try {
        await client.query("begin");
        const out = await fn(tx);
        await client.query("commit");
        return out;
      } catch (err) {
        await client.query("rollback").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    end: () => pool.end(),
  };
}
