import pg from "pg";

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export function createPgDb(databaseUrl: string): Db & { end(): Promise<void> } {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  pool.on("error", (err) => console.error("pg pool idle client error", err));
  return {
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      const res = await pool.query(sql, params as unknown[] | undefined);
      return res.rows as T[];
    },
    end: () => pool.end(),
  };
}
