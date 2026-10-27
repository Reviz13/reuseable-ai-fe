"use client";

import { useActionState, useEffect, useState } from "react";
import { AvatarStateSchema, type AvatarState } from "@ai/contracts";
import { FieldIssues, FormMessages } from "@/components/FormMessages";
import type { FormState } from "@/lib/action";
import type { z } from "zod";
import type { AssistantAdminSchema } from "@/lib/schemas";
import { saveAssistant, uploadAvatar } from "./actions";

const EMPTY: FormState = {};
export const STATES = AvatarStateSchema.options;

export function ConfigForm({ app, config }: { app: string; config: z.input<typeof AssistantAdminSchema> }) {
  const [state, action, pending] = useActionState(saveAssistant.bind(null, app), EMPTY);
  return (
    <form action={action}>
      <label htmlFor="name">Nama</label>
      <input id="name" name="name" type="text" defaultValue={config.name} required />
      <FieldIssues state={state} field="name" />

      <label htmlFor="persona_prompt">Persona</label>
      <textarea id="persona_prompt" name="persona_prompt" defaultValue={config.persona_prompt} />
      <FieldIssues state={state} field="persona_prompt" />

      <div className="row">
        <div>
          <label htmlFor="language">Bahasa</label>
          <input id="language" name="language" type="text" defaultValue={config.language} required />
          <FieldIssues state={state} field="language" />
        </div>
        <div>
          <label htmlFor="llm_adapter">Adapter</label>
          <select id="llm_adapter" name="llm_adapter" defaultValue={config.llm_adapter}>
            <option value="claude">claude</option>
            <option value="openai_compat">openai_compat</option>
          </select>
          <FieldIssues state={state} field="llm_adapter" />
        </div>
        <div>
          <label htmlFor="llm_model">Model</label>
          <input id="llm_model" name="llm_model" type="text" defaultValue={config.llm_model} required />
          <FieldIssues state={state} field="llm_model" />
        </div>
        <div>
          <label htmlFor="fallback_adapter">Fallback</label>
          <select id="fallback_adapter" name="fallback_adapter" defaultValue={config.fallback_adapter ?? ""}>
            <option value="">(tidak ada)</option>
            <option value="claude">claude</option>
            <option value="openai_compat">openai_compat</option>
          </select>
          <FieldIssues state={state} field="fallback_adapter" />
        </div>
      </div>

      <div className="row">
        <div>
          <label htmlFor="min_score">Skor minimum (0-1)</label>
          <input id="min_score" name="min_score" type="number" step="0.01" min="0" max="1" defaultValue={config.min_score} required />
          <FieldIssues state={state} field="min_score" />
        </div>
        <div>
          <label htmlFor="accent">Warna aksen</label>
          <input id="accent" name="accent" type="color" defaultValue={config.theme.accent} />
          <FieldIssues state={state} field="theme" />
        </div>
      </div>

      <label htmlFor="allowed_origins">Origin yang diizinkan (satu per baris)</label>
      <textarea id="allowed_origins" name="allowed_origins" defaultValue={(config.allowed_origins).join("\n")} />
      <FieldIssues state={state} field="allowed_origins" />

      <FormMessages state={state} />
      <p>
        <button type="submit" disabled={pending}>
          {pending ? "Menyimpan..." : "Simpan"}
        </button>
      </p>
    </form>
  );
}

export function AvatarSlot({ app, state, src }: { app: string; state: AvatarState; src?: string }) {
  const [result, action, pending] = useActionState(uploadAvatar.bind(null, app, state), EMPTY);
  return (
    <form action={action} className="slot">
      <strong>{state}</strong>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <div>{src ? <img src={src} alt={`Avatar ${state}`} /> : <p className="muted">Belum ada</p>}</div>
      <input type="file" name="file" accept="image/png,image/webp,image/jpeg" required aria-label={`Unggah avatar ${state}`} />
      <FormMessages state={result} />
      <button type="submit" disabled={pending}>
        {pending ? "..." : "Unggah"}
      </button>
    </form>
  );
}

/** Cycles idle -> thinking -> talking -> happy -> sad every 1.5 s using the public frame URLs. */
export function AvatarPreview({ frames }: { frames: Partial<Record<AvatarState, string>> }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % STATES.length), 1500);
    return () => clearInterval(t);
  }, []);
  const current = STATES[i]!;
  const src = frames[current];
  return (
    <div className="preview">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt={`Pratinjau ${current}`} /> : <p className="muted">Belum ada gambar</p>}
      <p>{current}</p>
    </div>
  );
}
