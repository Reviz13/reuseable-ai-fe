import { AdminApiError, issuesOf, type Issue } from "./errors";

export interface FormState {
  ok?: boolean;
  message?: string;
  error?: string;
  issues?: Issue[];
}

/** Turns ai-service errors into form state. Redirects and ForbiddenError propagate untouched. */
export async function runAction(
  fn: () => Promise<FormState | void>,
  statusCopy: Record<number, string> = {},
): Promise<FormState> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (err) {
    if (err instanceof AdminApiError) {
      const issues = issuesOf(err.body);
      const body = err.body as { message?: string } | undefined;
      return {
        error:
          statusCopy[err.status] ??
          (issues.length ? "Data tidak valid. Periksa isian di bawah." : (body?.message ?? `Permintaan gagal (${err.status}).`)),
        issues,
      };
    }
    throw err;
  }
}
