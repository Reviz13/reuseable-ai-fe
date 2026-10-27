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

export function createPgDb(databaseUrl: string): Db & { end(): Promise<void> } {
  const pool = new pg.Pool({ connectionString: databaseUrl });
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
