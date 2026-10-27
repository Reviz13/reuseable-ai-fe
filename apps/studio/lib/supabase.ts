import { createServerClient } from "@supabase/ssr";
import type { CookieToSet } from "./cookies";
import { cookies } from "next/headers";
import { supabaseEnv } from "./env";

/** Server client (Server Components, Server Actions, route handlers). Anon key only. */
export async function createServerSupabase() {
  const { url, anonKey } = supabaseEnv();
  const store = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list: CookieToSet[]) {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component: cookies are read-only there; middleware refreshes them.
        }
      },
    },
  });
}
