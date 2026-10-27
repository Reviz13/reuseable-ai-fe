"use server";

import { revalidatePath } from "next/cache";
import { AvatarStateSchema } from "@ai/contracts";
import { aiAdmin } from "@/lib/aiAdmin";
import { runAction, type FormState } from "@/lib/action";
import { parseApp } from "@/lib/guard";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

export async function saveAssistant(app: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const appId = parseApp(app);
  const fallback = str(fd, "fallback_adapter");
  const config = {
    name: str(fd, "name"),
    persona_prompt: str(fd, "persona_prompt"),
    language: str(fd, "language"),
    llm_adapter: str(fd, "llm_adapter"),
    llm_model: str(fd, "llm_model"),
    fallback_adapter: fallback === "" ? null : fallback,
    theme: { accent: str(fd, "accent") },
    allowed_origins: str(fd, "allowed_origins")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean),
    min_score: str(fd, "min_score") === "" ? Number.NaN : Number(str(fd, "min_score")),
  };
  // NaN serialises to null, which the schema rejects and reports against min_score.
  return runAction(async () => {
    await aiAdmin(`/admin/${appId}/assistant`, { method: "PUT", body: JSON.stringify(config) });
    revalidatePath(`/admin/${appId}/assistant`);
    return { ok: true, message: "Konfigurasi disimpan." };
  });
}

export async function uploadAvatar(app: string, state: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const appId = parseApp(app);
  const s = AvatarStateSchema.parse(state);
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Pilih gambar terlebih dahulu." };
  return runAction(
    async () => {
      const body = new FormData();
      body.set("file", file, file.name);
      await aiAdmin(`/admin/${appId}/avatar/${s}`, { method: "PUT", body });
      revalidatePath(`/admin/${appId}/assistant`);
      return { ok: true, message: "Avatar diperbarui." };
    },
    { 413: "Gambar terlalu besar (maksimal 5 MB).", 415: "Gunakan gambar PNG, WebP, atau JPG." },
  );
}
