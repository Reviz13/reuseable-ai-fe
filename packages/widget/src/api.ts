import { PublicAssistantSchema, type AppId, type PublicAssistant, type SseEvent } from "@ai/contracts";
import { GENERIC } from "./copy";
import { parseSse } from "./sse";

export type ApiErrorCode = "UNAUTHORIZED" | "RATE_LIMITED" | "BAD_REQUEST" | "NOT_FOUND" | "NETWORK" | "INTERNAL";

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message = "",
  ) {
    super(message);
  }
}

export interface ApiClient {
  publicAssistant(): Promise<PublicAssistant | null>;
  chat(
    body: { message: string; conversation_id?: string },
    onEvent: (e: SseEvent) => void,
    signal: AbortSignal,
  ): Promise<void>;
  feedback(body: { message_id: string; rating: 1 | -1; comment?: string }): Promise<void>;
}

export const isAbort = (e: unknown) => e instanceof Error && e.name === "AbortError";

async function errorFrom(res: Response): Promise<ApiError> {
  let message = "";
  try {
    const j = (await res.json()) as { message?: unknown };
    if (typeof j.message === "string") message = j.message;
  } catch {
    /* non-JSON error body */
  }
  if (res.status === 401) return new ApiError("UNAUTHORIZED");
  if (res.status === 429) return new ApiError("RATE_LIMITED", message);
  if (res.status === 400) return new ApiError("BAD_REQUEST", message);
  if (res.status === 404) return new ApiError("NOT_FOUND", message);
  return new ApiError("INTERNAL", message || GENERIC);
}

export function createApiClient(opts: {
  api: string;
  app: AppId | string;
  getToken: () => Promise<string>;
}): ApiClient {
  const base = opts.api.replace(/\/+$/, "");
  let token: string | null = null; // in memory only

  const fetchToken = async (): Promise<string> => {
    try {
      token = await opts.getToken();
    } catch {
      token = null;
      throw new ApiError("UNAUTHORIZED");
    }
    if (!token) throw new ApiError("UNAUTHORIZED");
    return token;
  };

  /** POST with bearer auth; on 401 refresh the token once and retry. */
  const authedPost = async (path: string, body: unknown, signal?: AbortSignal): Promise<Response> => {
    const attempt = async (t: string) => {
      try {
        return await fetch(base + path, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${t}` },
          body: JSON.stringify(body),
          signal,
        });
      } catch (e) {
        if (isAbort(e)) throw e;
        throw new ApiError("NETWORK");
      }
    };
    let res = await attempt(token ?? (await fetchToken()));
    if (res.status === 401) {
      token = null;
      res = await attempt(await fetchToken());
      if (res.status === 401) throw new ApiError("UNAUTHORIZED");
    }
    return res;
  };

  return {
    async publicAssistant() {
      try {
        const res = await fetch(`${base}/v1/assistants/${opts.app}/public`);
        if (!res.ok) return null;
        const parsed = PublicAssistantSchema.safeParse(await res.json());
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },

    async chat(body, onEvent, signal) {
      const res = await authedPost("/v1/chat", { app: opts.app, ...body }, signal);
      if (!res.ok) throw await errorFrom(res);
      if (!res.body) throw new ApiError("NETWORK");
      try {
        for await (const ev of parseSse(res.body)) onEvent(ev);
      } catch (e) {
        if (isAbort(e) || signal.aborted) throw e;
        throw new ApiError("NETWORK");
      }
    },

    async feedback(body) {
      const res = await authedPost("/v1/feedback", { app: opts.app, ...body });
      if (!res.ok) throw await errorFrom(res);
    },
  };
}
