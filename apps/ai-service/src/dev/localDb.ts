import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "../db.js";

/**
 * In-process Postgres (PGlite + pgvector) with Supabase stubs, every migration and seed.sql applied.
 * Single source of truth for the int-test harness (test/int/pglite.ts) and ai-service LOCAL_MODE.
 * Dev/test only: @electric-sql/pglite is a devDependency and is imported lazily.
 */

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

// Mimic Supabase default privileges (set before migrations) so that RLS, and the revoke in
// 0003, are what actually block access, not missing grants.
const DEFAULT_PRIVS = `
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public grant select on tables to anon, authenticated;
`;

function stripPgCron(sql: string): string {
  return sql
    .split("\n")
    .filter((l) => !/create extension if not exists pg_cron/i.test(l))
    .join("\n");
}

export interface LocalDb {
  db: Db;
  pg: PGlite;
  close(): Promise<void>;
}

export async function createLocalDb(): Promise<LocalDb> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { vector } = await import("@electric-sql/pglite/vector");
  const pg = new PGlite({ extensions: { vector } });
  await pg.exec(STUBS);
  await pg.exec(DEFAULT_PRIVS);
  const files = readdirSync(join(supabaseDir, "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    await pg.exec(stripPgCron(readFileSync(join(supabaseDir, "migrations", f), "utf8")));
  }
  await pg.exec(readFileSync(join(supabaseDir, "seed.sql"), "utf8"));
  return { db: pgliteDb(pg), pg, close: () => pg.close() };
}
