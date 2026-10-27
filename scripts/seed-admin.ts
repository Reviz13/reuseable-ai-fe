// Creates the dev admin (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD) and grants it app "pos".
// Run once after the hosted Supabase project exists: `pnpm seed:admin`. Reads the root .env.
// Both the auth user (Admin API) and the `admins` row go through supabase-js with the service role
// key, which bypasses RLS (the table has RLS with no policies). No DATABASE_URL, no direct pg (S10).
import { createClient } from "@supabase/supabase-js";

const APP = "pos";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (fill the root .env)`);
  return v;
}

const url = need("SUPABASE_URL");
const serviceKey = need("SUPABASE_SERVICE_ROLE_KEY");
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

  // Keep any apps the account already has; add "pos".
  const existing = await sb.from("admins").select("apps").eq("user_id", userId).maybeSingle();
  if (existing.error) throw existing.error;
  const apps = [...new Set([...((existing.data?.apps as string[] | undefined) ?? []), APP])];
  const up = await sb.from("admins").upsert({ user_id: userId, apps }, { onConflict: "user_id" });
  if (up.error) throw up.error;
  console.log(`admin ready: ${email}`);
}

main().catch((e) => {
  console.error("seed-admin failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
