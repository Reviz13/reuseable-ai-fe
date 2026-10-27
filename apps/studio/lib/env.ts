// Read at call time, never at module load, so `next build` works with no .env present.
export function aiServiceUrl(): string {
  const v = process.env.AI_SERVICE_URL;
  if (!v) throw new Error("AI_SERVICE_URL is not set");
  return v.replace(/\/+$/, "");
}

export function supabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set");
  return { url, anonKey };
}
