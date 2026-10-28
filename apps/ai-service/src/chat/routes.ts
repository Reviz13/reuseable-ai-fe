import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { AppIdSchema, ChatRequestSchema, encodeSse, FeedbackRequestSchema, type SseEvent } from "@ai/contracts";
import { createAuditWriter } from "../audit.js";
import { copyFor, RATE_LIMITED, TOO_LONG } from "../copy.js";
import { HttpError, parseRequest } from "../http.js";
import { LlmUnavailableError, type LlmMessage } from "../llm/types.js";
import { createRetriever } from "../rag/retriever.js";
import { runChat, type AssistantRow, type Retrieve } from "./orchestrator.js";

const MAX_MESSAGE_CHARS = 2000;
const HISTORY_WINDOW = 10;
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

const BodyAppSchema = z.object({ app: AppIdSchema });
const FeedbackBodySchema = FeedbackRequestSchema.extend({ app: AppIdSchema });

const SSE_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache",
  connection: "keep-alive",
  "x-accel-buffering": "no",
} as const;

export function registerChatRoutes(app: FastifyInstance): void {
  const deps = app.deps;
  const db = deps.db;
  const audit = createAuditWriter(db, (msg, err) => app.log.error({ err }, msg));
  const retrieve: Retrieve = deps.embedder ? createRetriever(db, deps.embedder) : async () => [];

  /** End-user auth for routes whose app is in the JSON body. */
  const endUserFromBody = async (req: FastifyRequest, reply: FastifyReply) => {
    const { app: appId } = parseRequest(BodyAppSchema, req.body);
    await app.requireEndUser(appId)(req, reply);
  };

  app.post(
    "/v1/chat",
    {
      preHandler: [endUserFromBody],
      config: {
        rateLimit: {
          max: RATE_LIMIT_MAX,
          timeWindow: RATE_LIMIT_WINDOW_MS,
          // Runs after endUserFromBody (appended to the route's preHandlers), so the key is the verified sub.
          hook: "preHandler",
          keyGenerator: (req: FastifyRequest) => `${req.claims.iss}:${req.claims.sub}`,
          errorResponseBuilder: () =>
            new HttpError(429, "rate_limited", undefined, { error: "rate_limited", message: RATE_LIMITED }),
        },
      },
    },
    async (req, reply) => {
      const started = Date.now();
      const raw = (req.body as { message?: unknown }).message;
      if (typeof raw === "string" && raw.trim().length > MAX_MESSAGE_CHARS) {
        throw new HttpError(400, "bad_request", undefined, { error: "bad_request", message: TOO_LONG });
      }
      const body = parseRequest(ChatRequestSchema, req.body);
      const claims = req.claims;

      const [assistant] = await db.query<AssistantRow>(
        `select app, name, persona_prompt, language, llm_adapter, llm_model, fallback_adapter, min_score
           from assistants where app = $1`,
        [body.app],
      );
      if (!assistant) throw new HttpError(404, "assistant not found");
      if (!deps.gatewayFor || !deps.pos) throw new Error("chat dependencies (gatewayFor, pos) are not configured");

      let conversationId: string;
      if (body.conversation_id) {
        const rows = await db.query<{ id: string }>(
          "select id from conversations where id = $1 and app = $2 and user_id = $3",
          [body.conversation_id, body.app, claims.sub],
        );
        if (!rows[0]) throw new HttpError(404, "conversation not found");
        conversationId = rows[0].id;
      } else {
        const rows = await db.query<{ id: string }>(
          "insert into conversations (app, user_id, outlet_id) values ($1, $2, $3) returning id",
          [body.app, claims.sub, claims.outlet_id],
        );
        conversationId = rows[0]!.id;
      }

      const recent = await db.query<{ role: "user" | "assistant"; content: string }>(
        `select role, content from messages where conversation_id = $1
          order by created_at desc, id desc limit $2`,
        [conversationId, HISTORY_WINDOW],
      );
      const history: LlmMessage[] = recent.reverse().map((m) => ({ role: m.role, content: m.content }));
      await db.query(
        "insert into messages (conversation_id, role, content, created_at) values ($1, 'user', $2, clock_timestamp())",
        [conversationId, body.message],
      );

      // From here on the response is SSE; errors become `error` events, not JSON.
      // Headers set by onRequest hooks (CORS) live on the reply, so they are copied onto the raw response.
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, { ...(reply.getHeaders() as Record<string, string>), ...SSE_HEADERS });
      const ac = new AbortController();
      // Not req.raw "close": on current Node it fires as soon as the request body is consumed.
      res.on("close", () => {
        if (!res.writableFinished) ac.abort();
      });
      // The client may have gone while auth/DB work ran, before the listener existed.
      if (res.destroyed || req.raw.socket?.destroyed) ac.abort();
      const emit = (e: SseEvent) => {
        if (!res.writableEnded && !res.destroyed) res.write(encodeSse(e));
      };

      try {
        const result = await runChat(
          { llm: deps.gatewayFor(assistant), retrieve, pos: deps.pos, audit, now: deps.now },
          { assistant, claims, conversationId, message: body.message, history },
          emit,
          ac.signal,
        );
        if (result && !ac.signal.aborted) {
          const [msg] = await db.query<{ id: string }>(
            `insert into messages (conversation_id, role, content, citations, tool_calls, guardrail_replaced, latency_ms, created_at)
             values ($1, 'assistant', $2, $3::jsonb, $4::jsonb, $5, $6, clock_timestamp()) returning id`,
            [
              conversationId,
              result.text,
              JSON.stringify(result.citations),
              JSON.stringify(result.toolCalls),
              result.guardrailReplaced,
              Date.now() - started,
            ],
          );
          if (result.toolCalls.length === 0 && result.text.includes(copyFor(assistant.language).NOT_FOUND)) {
            await db.query("insert into knowledge_gaps (app, question, top_score) values ($1, $2, $3)", [
              body.app,
              body.message,
              result.topScore,
            ]);
          }
          emit({ type: "done", message_id: msg!.id, conversation_id: conversationId });
        }
      } catch (err) {
        if (err instanceof LlmUnavailableError) {
          req.log.warn({ err }, "llm unavailable");
          emit({ type: "error", code: "LLM_UNAVAILABLE", message: copyFor(assistant.language).LLM_UNAVAILABLE });
        } else if (!ac.signal.aborted) {
          req.log.error({ err }, "chat failed");
          emit({ type: "error", code: "INTERNAL", message: copyFor(assistant.language).INTERNAL });
        }
        emit({ type: "state", avatar: "sad" });
      } finally {
        if (!res.writableEnded) res.end();
      }
    },
  );

  app.post("/v1/feedback", { preHandler: [endUserFromBody] }, async (req) => {
    const body = parseRequest(FeedbackBodySchema, req.body);
    const owned = await db.query<{ id: string }>(
      `select m.id from messages m join conversations c on c.id = m.conversation_id
        where m.id = $1 and c.app = $2 and c.user_id = $3`,
      [body.message_id, body.app, req.claims.sub],
    );
    if (!owned[0]) throw new HttpError(404, "message not found");
    await db.query(
      `insert into feedback (message_id, rating, comment) values ($1, $2, $3)
       on conflict (message_id) do update set rating = excluded.rating, comment = excluded.comment, created_at = now()`,
      [body.message_id, body.rating, body.comment ?? null],
    );
    return { ok: true };
  });
}
