export class ForbiddenError extends Error {
  constructor(message = "forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class AdminApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`ai-service responded ${status}`);
    this.name = "AdminApiError";
  }
}

export interface Issue {
  path: (string | number)[];
  code: string;
}

/** Validation issues from an ai-service 400 body, if it carries any. */
export function issuesOf(body: unknown): Issue[] {
  if (body && typeof body === "object" && Array.isArray((body as { issues?: unknown }).issues)) {
    return (body as { issues: Issue[] }).issues;
  }
  return [];
}
