"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { FieldIssues, FormMessages } from "@/components/FormMessages";
import type { FormState } from "@/lib/action";
import { addFaq, updateFaq, uploadDocument } from "./actions";

const EMPTY: FormState = {};

/** Re-fetches the server component every 3 s while any document is still processing. */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}

export function UploadForm({ app, documentId }: { app: string; documentId?: string }) {
  const [state, action, pending] = useActionState(uploadDocument.bind(null, app), EMPTY);
  return (
    <form action={action}>
      {documentId && <input type="hidden" name="document_id" value={documentId} />}
      <label htmlFor="file">{documentId ? "Upload a new version" : "Upload a file (PDF, DOCX, MD, TXT)"}</label>
      <input id="file" name="file" type="file" accept=".pdf,.docx,.md,.txt" required />
      <FormMessages state={state} />
      <p>
        <button type="submit" disabled={pending}>
          {pending ? "Uploading..." : "Upload"}
        </button>
      </p>
    </form>
  );
}

export function FaqForm({ app }: { app: string }) {
  const [state, action, pending] = useActionState(addFaq.bind(null, app), EMPTY);
  return (
    <form action={action} key={state.ok ? "done" : "form"}>
      <label htmlFor="question">Question</label>
      <input id="question" name="question" type="text" required maxLength={500} />
      <FieldIssues state={state} field="question" />
      <label htmlFor="answer">Answer</label>
      <textarea id="answer" name="answer" required maxLength={5000} />
      <FieldIssues state={state} field="answer" />
      <FormMessages state={state} />
      <p>
        <button type="submit" disabled={pending}>
          {pending ? "Saving..." : "Add FAQ"}
        </button>
      </p>
    </form>
  );
}

export function EditFaqForm({
  app,
  documentId,
  faq,
}: {
  app: string;
  documentId: string;
  faq: { question: string; answer: string };
}) {
  const [state, action, pending] = useActionState(updateFaq.bind(null, app, documentId), EMPTY);
  return (
    <form action={action}>
      <label htmlFor="question">Question</label>
      <input id="question" name="question" type="text" required maxLength={500} defaultValue={faq.question} />
      <FieldIssues state={state} field="question" />
      <label htmlFor="answer">Answer</label>
      <textarea id="answer" name="answer" required maxLength={5000} defaultValue={faq.answer} />
      <FieldIssues state={state} field="answer" />
      <FormMessages state={state} />
      <p>
        <button type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save changes"}
        </button>
      </p>
    </form>
  );
}
