import type { ZodTypeAny, z } from "zod";

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public issues?: { path: (string | number)[]; code: string }[],
  ) {
    super(message);
  }
}

/**
 * Validates request input. On failure throws a 400 listing only each issue's path and zod code:
 * zod messages can echo received values or key names, so they are never returned.
 */
export function parseRequest<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  throw new HttpError(
    400,
    "bad_request",
    r.error.issues.map((i) => ({ path: i.path, code: i.code })),
  );
}
