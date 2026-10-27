"use server";

import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase";

export async function logout(): Promise<void> {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  redirect("/login");
}
