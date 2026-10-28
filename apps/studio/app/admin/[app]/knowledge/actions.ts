"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { aiAdmin } from "@/lib/aiAdmin";
import { runAction, type FormState } from "@/lib/action";
import { parseApp } from "@/lib/guard";

const UPLOAD_ERRORS: Record<number, string> = {
  413: "File is too large (max 20 MB).",
  415: "File type not supported (use PDF, DOCX, MD, or TXT).",
};

export async function uploadDocument(app: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const appId = parseApp(app);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file first." };
  return runAction(async () => {
    const body = new FormData();
    body.set("file", file, file.name);
    const documentId = formData.get("document_id");
    const qs = typeof documentId === "string" && documentId ? `?document_id=${encodeURIComponent(documentId)}` : "";
    await aiAdmin(`/admin/${appId}/documents${qs}`, { method: "POST", body });
    revalidatePath(`/admin/${appId}/knowledge`);
    return { ok: true, message: "File uploaded and processing." };
  }, UPLOAD_ERRORS);
}

export async function addFaq(app: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const appId = parseApp(app);
  return runAction(async () => {
    await aiAdmin(`/admin/${appId}/faqs`, {
      method: "POST",
      body: JSON.stringify({ question: String(formData.get("question") ?? ""), answer: String(formData.get("answer") ?? "") }),
    });
    revalidatePath(`/admin/${appId}/knowledge`);
    return { ok: true, message: "FAQ added." };
  });
}

export async function updateFaq(app: string, documentId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const appId = parseApp(app);
  const state = await runAction(async () => {
    await aiAdmin(`/admin/${appId}/faqs/${encodeURIComponent(documentId)}`, {
      method: "PUT",
      body: JSON.stringify({ question: String(formData.get("question") ?? ""), answer: String(formData.get("answer") ?? "") }),
    });
    return { ok: true, message: "FAQ updated." };
  });
  revalidatePath(`/admin/${appId}/knowledge/${documentId}`);
  revalidatePath(`/admin/${appId}/knowledge`);
  return state;
}

export async function activateVersion(app: string, documentId: string, versionId: string): Promise<FormState> {
  const appId = parseApp(app);
  const state = await runAction(
    async () => {
      await aiAdmin(`/admin/${appId}/documents/${encodeURIComponent(documentId)}/activate`, {
        method: "POST",
        body: JSON.stringify({ version_id: versionId }),
      });
      return { ok: true, message: "Version activated." };
    },
    { 409: "This version failed to process or is empty" },
  );
  revalidatePath(`/admin/${appId}/knowledge/${documentId}`);
  revalidatePath(`/admin/${appId}/knowledge`);
  return state;
}

export async function deleteDocument(app: string, documentId: string): Promise<void> {
  const appId = parseApp(app);
  await aiAdmin(`/admin/${appId}/documents/${encodeURIComponent(documentId)}`, { method: "DELETE" });
  revalidatePath(`/admin/${appId}/knowledge`);
  redirect(`/admin/${appId}/knowledge`);
}
