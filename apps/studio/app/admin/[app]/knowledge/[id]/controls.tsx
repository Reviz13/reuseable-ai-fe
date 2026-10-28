"use client";

import { useState, useTransition } from "react";
import type { FormState } from "@/lib/action";
import { activateVersion, deleteDocument } from "../actions";

export function ActivateButton({ app, documentId, versionId }: { app: string; documentId: string; versionId: string }) {
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  return (
    <>
      <button
        type="button"
        className="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setState(await activateVersion(app, documentId, versionId));
          })
        }
      >
        Activate
      </button>
      {state.error && (
        <div className="error" role="alert">
          {state.error}
        </div>
      )}
    </>
  );
}

export function DeleteButton({ app, documentId }: { app: string; documentId: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="danger"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("Delete this document from the knowledge base? Old versions are kept for audit.")) return;
        start(async () => {
          await deleteDocument(app, documentId);
        });
      }}
    >
      Delete
    </button>
  );
}
