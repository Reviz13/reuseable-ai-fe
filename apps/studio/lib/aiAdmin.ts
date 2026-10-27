import "server-only";
import { redirect } from "next/navigation";
import type { z } from "zod";
import { aiServiceUrl } from "./env";
import { AdminApiError, ForbiddenError } from "./errors";
import { createServerSupabase } from "./supabase";

export type AiAdminInit<T> = RequestInit & { schema?: z.ZodType<T> };

/**
 * Calls ai-service as the signed-in admin. 401 or no session -> /login, 403 -> ForbiddenError,
 * any other non-2xx -> AdminApiError(status, body).
 */
export async function aiAdmin<T = unknown>(path: string, init: AiAdminInit<T> = {}): Promise<T> {
  const { schema, ...rest } = init;
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) redirect("/login");

  const headers = new Headers(rest.headers);
  headers.set("authorization", `Bearer ${token}`);
  // JSON string bodies get a content-type; FormData must keep its own multipart boundary.
  if (typeof rest.body === "string" && !headers.has("content-type")) headers.set("content-type", "application/json");

  const res = await fetch(`${aiServiceUrl()}${path}`, { ...rest, headers, cache: "no-store" });
  const text = await res.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (res.status === 401) redirect("/login");
  if (res.status === 403) throw new ForbiddenError();
  if (!res.ok) throw new AdminApiError(res.status, body);
  return schema ? schema.parse(body) : (body as T);
}
