import type { FormState } from "@/lib/action";

/** Banner + per-field validation issues from an ai-service 400. */
export function FormMessages({ state }: { state: FormState }) {
  return (
    <>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.message && <p className="ok">{state.message}</p>}
    </>
  );
}

export function FieldIssues({ state, field }: { state: FormState; field: string }) {
  const hits = (state.issues ?? []).filter((i) => i.path[0] === field);
  if (!hits.length) return null;
  return (
    <ul className="issues">
      {hits.map((i, n) => (
        <li key={n}>
          {field}: {i.code}
        </li>
      ))}
    </ul>
  );
}
