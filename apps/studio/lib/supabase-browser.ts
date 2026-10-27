import { createBrowserClient } from "@supabase/ssr";

/** Browser client. url/key come from the server at request time (props), never from build-time env. */
export function createBrowserSupabase(url: string, anonKey: string) {
  return createBrowserClient(url, anonKey);
}
