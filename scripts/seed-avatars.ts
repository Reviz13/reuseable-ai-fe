// Uploads assets/avatar/pos/<state>.webp through the admin API. Run after `pnpm dev` is up: `pnpm seed:avatars`.
// Signs in as the seeded admin with the anon key; the password only goes to Supabase Auth.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const STATES = ["idle", "thinking", "talking", "happy", "sad"] as const;

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (fill the root .env)`);
  return v;
}

async function main() {
  const sb = createClient(need("SUPABASE_URL"), need("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sb.auth.signInWithPassword({
    email: need("SEED_ADMIN_EMAIL"),
    password: need("SEED_ADMIN_PASSWORD"),
  });
  if (error || !data.session) throw new Error(`sign-in failed: ${error?.message ?? "no session"}`);
  const token = data.session.access_token;
  const base = need("AI_SERVICE_URL").replace(/\/+$/, "");

  let failed = 0;
  for (const state of STATES) {
    const bytes = await readFile(resolve(process.cwd(), "assets/avatar/pos", `${state}.webp`));
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: "image/webp" }), `${state}.webp`);
    const res = await fetch(`${base}/admin/pos/avatar/${state}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
    console.log(`${state}: ${res.status}`);
    if (!res.ok) failed++;
  }
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error("seed-avatars failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
