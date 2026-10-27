// Read at call time, never at module load, so `next build` works with no env present.
// Only unprefixed server env vars: NEXT_PUBLIC_* is inlined at build time and would bake in undefined.
export function aiServiceUrl(): string {
  const v = process.env.AI_SERVICE_URL;
  if (!v) throw new Error("AI_SERVICE_URL is not set");
  return v.replace(/\/+$/, "");
}

export function supabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY are not set");
  return { url, anonKey };
}
