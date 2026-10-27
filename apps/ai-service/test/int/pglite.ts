import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import type { Db } from "../../src/db.js";

const here = dirname(fileURLToPath(import.meta.url));
const supabaseDir = join(here, "../../../../supabase");

export function pgliteDb(pg: PGlite): Db {
  return {
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      const res = await pg.query<T>(sql, params);
      return res.rows;
    },
  };
}

const STUBS = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create table auth.users (id uuid primary key, email text);
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create schema cron;
create function cron.schedule(text, text, text) returns bigint language sql as $$ select 1::bigint $$;
`;

// Test-only grants so that RLS (not missing privileges) is what blocks anon,
// and so audit_log trigger/revoke behaviour can be exercised as service_role.
const TEST_GRANTS = `
grant usage on schema public to anon, authenticated, service_role;
grant select on all tables in schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;
`;

function stripPgCron(sql: string): string {
  return sql
    .split("\n")
    .filter((l) => !/create extension if not exists pg_cron/i.test(l))
    .join("\n");
}

export async function createTestDb(): Promise<{ db: Db; pg: PGlite; close(): Promise<void> }> {
  const pg = new PGlite({ extensions: { vector } });
  await pg.exec(STUBS);
  const files = readdirSync(join(supabaseDir, "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    await pg.exec(stripPgCron(readFileSync(join(supabaseDir, "migrations", f), "utf8")));
  }
  await pg.exec(readFileSync(join(supabaseDir, "seed.sql"), "utf8"));
  // Applied after migrations: grants on audit_log from the migration's revoke must still win,
  // so re-apply the revoke the same way Supabase's default privileges would not.
  await pg.exec(TEST_GRANTS);
  await pg.exec("revoke update, delete on audit_log from anon, authenticated, service_role;");
  return { db: pgliteDb(pg), pg, close: () => pg.close() };
}
