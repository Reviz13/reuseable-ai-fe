// Creates the dev admin (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD) and grants it app "pos".
// Run once after the hosted Supabase project exists: `pnpm seed:admin`. Reads the root .env.
// Auth user goes through the Admin API (service role key). The `admins` row is written with a
// direct pg query on DATABASE_URL: the table has RLS with no policies, and the owner connection bypasses it.
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (fill the root .env)`);
  return v;
}

const url = need("SUPABASE_URL");
const serviceKey = need("SUPABASE_SERVICE_ROLE_KEY");
const databaseUrl = need("DATABASE_URL");
const email = need("SEED_ADMIN_EMAIL");
const password = need("SEED_ADMIN_PASSWORD");

const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function findUserId(): Promise<string | null> {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function main() {
  const created = await sb.auth.admin.createUser({ email, password, email_confirm: true });
  let userId = created.data.user?.id ?? null;
  if (!userId) {
    // Most likely "already registered": reuse the existing account (its password is left untouched).
    userId = await findUserId();
    if (!userId) throw created.error ?? new Error("could not create or find admin user");
  }

  const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(
      `insert into admins (user_id, apps) values ($1, '{pos}')
       on conflict (user_id) do update set apps = (select array(select distinct unnest(admins.apps || '{pos}')))`,
      [userId],
    );
  } finally {
    await client.end();
  }
  console.log(`admin ready: ${email}`);
}

main().catch((e) => {
  console.error("seed-admin failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
