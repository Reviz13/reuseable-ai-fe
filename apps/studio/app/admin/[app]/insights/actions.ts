"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { aiAdmin } from "@/lib/aiAdmin";
import { parseApp } from "@/lib/guard";

export async function resolveGap(app: string, formData: FormData): Promise<void> {
  const appId = parseApp(app);
  const id = z.string().uuid().parse(formData.get("id"));
  await aiAdmin(`/admin/${appId}/gaps/${id}/resolve`, { method: "POST" });
  revalidatePath(`/admin/${appId}/insights`);
}
