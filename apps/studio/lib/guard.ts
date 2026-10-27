import "server-only";
import { notFound, redirect } from "next/navigation";
import { AppIdSchema, type AppId } from "@ai/contracts";
import { createServerSupabase } from "./supabase";

/** Validates the `[app]` route param. Unknown app -> 404. */
export function parseApp(param: string): AppId {
  const r = AppIdSchema.safeParse(param);
  if (!r.success) notFound();
  return r.data;
}

/** No Supabase session -> /login. Whether the account may use `app` is decided by ai-service (403). */
export async function requireAdminSession(app: AppId): Promise<{ app: AppId; email: string | undefined }> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getSession();
  if (!data.session) redirect("/login");
  return { app, email: data.session.user.email };
}
