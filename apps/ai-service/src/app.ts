import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { AppIdSchema, type AppId, type JwtClaims } from "@ai/contracts";
import { AuthError } from "./auth/errors.js";
import type { AdminIdentity, AdminVerifier } from "./auth/admin.js";
import type { EndUserVerifier } from "./auth/endUser.js";
import type { BlobStore } from "./blob.js";
import type { Config } from "./config.js";
import { createCorsOriginLookup } from "./cors.js";
import type { Db } from "./db.js";
import type { Embedder } from "./rag/embedder.js";
import { registerAssistantRoutes } from "./admin/assistant.js";
import { registerInsightRoutes } from "./admin/insights.js";
import { registerKnowledgeRoutes } from "./admin/knowledge.js";
import { registerChatRoutes } from "./chat/routes.js";
import { HttpError } from "./http.js";
import type { LlmAdapter } from "./llm/types.js";
import type { AdapterName } from "./llm/gateway.js";
import type { PosAdapter } from "./profit/posAdapter.js";
import { registerPublicRoutes, registerWidgetStatic } from "./public/routes.js";

export interface AppDeps {
  config: Config;
  db: Db;
  blob: BlobStore;
  verifyEndUser: EndUserVerifier;
  verifyAdmin: AdminVerifier;
  now: () => Date;
  /** Required by POST /v1/chat. */
  gatewayFor?: (assistant: { llm_adapter: AdapterName; fallback_adapter: AdapterName | null }) => LlmAdapter;
  /** Required by knowledge ingestion and chat retrieval. Without it chat runs with no knowledge. */
  embedder?: Embedder;
  /** Required by the get_profit tool. */
  pos?: PosAdapter;
}

type Guard = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

declare module "fastify" {
  interface FastifyRequest {
    claims: JwtClaims;
    admin: AdminIdentity;
  }
  interface FastifyInstance {
    deps: AppDeps;
    requireEndUser(app: AppId): Guard;
    requireAdmin(app: AppId): Guard;
    invalidateCorsCache(app: string): void;
  }
}

function bearer(req: FastifyRequest): string {
  const h = req.headers.authorization;
  const m = h ? /^Bearer\s+(.+)$/i.exec(h) : null;
  if (!m) throw new AuthError("missing bearer token");
  return m[1]!;
}

// S4: secrets in headers never reach the log, whether logged under req or as a bare headers object.
const REDACT = [
  "req.headers.authorization",
  "req.headers['x-internal-key']",
  "headers.authorization",
  "headers['x-internal-key']",
];

export function createApp(
  deps: AppDeps,
  opts: { logger?: boolean; /** Test hook: capture log lines. */ logStream?: { write(line: string): void } } = {},
): FastifyInstance {
  const app = Fastify({
    logger: opts.logger
      ? { redact: REDACT, ...(opts.logStream ? { stream: opts.logStream } : {}) }
      : false,
  });
  const corsLookup = createCorsOriginLookup(deps.db, () => deps.now().getTime());

  app.decorate("deps", deps);
  app.decorate("invalidateCorsCache", (a: string) => corsLookup.invalidate(a));
  app.decorateRequest("claims", undefined as unknown as JwtClaims);
  app.decorateRequest("admin", undefined as unknown as AdminIdentity);

  // CORS applies to /v1/* only. /admin/* is server-to-server and gets no CORS headers.
  void app.register(cors, {
    delegator: (req, cb) => {
      const url = req.url ?? "";
      if (!url.startsWith("/v1/")) return cb(null, { origin: false });
      const origin = req.headers.origin;
      if (!origin) return cb(null, { origin: false });
      const path = url.split("?")[0]!;
      let lookup: Promise<string[]>;
      if (path === "/v1/chat" || path === "/v1/feedback") {
        // The app is only in the body, which preflights do not carry. The per-app JWT (iss == app)
        // still gates access, so the union of all assistants' origins is used here.
        lookup = corsLookup.anyAllowedOrigins();
      } else {
        const seg = /^\/v1\/assistants\/([^/]+)/.exec(path)?.[1] ?? /^\/v1\/([^/]+)/.exec(path)?.[1];
        const parsedApp = AppIdSchema.safeParse(seg);
        if (!parsedApp.success) return cb(null, { origin: false });
        lookup = corsLookup.allowedOrigins(parsedApp.data);
      }
      lookup.then(
        (allowed) => cb(null, { origin: allowed.includes(origin), credentials: false }),
        (err) => cb(err as Error, { origin: false }),
      );
    },
  });

  app.setErrorHandler((err: Error, _req, reply) => {
    if (err instanceof AuthError) return reply.code(401).send({ error: "unauthorized" });
    if (err instanceof HttpError && err.body) return reply.code(err.statusCode).send(err.body);
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      const issues = (err as { issues?: unknown }).issues;
      return reply.code(status).send(issues ? { error: err.message, issues } : { error: err.message });
    }
    app.log.error(err);
    return reply.code(500).send({ error: "internal error" });
  });

  app.decorate("requireEndUser", (appId: AppId): Guard => async (req) => {
    req.claims = await deps.verifyEndUser(bearer(req), appId);
  });

  app.decorate("requireAdmin", (appId: AppId): Guard => async (req, reply) => {
    const admin = await deps.verifyAdmin(bearer(req));
    if (!admin.apps.includes(appId)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    req.admin = admin;
  });

  void app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 1 } });
  registerKnowledgeRoutes(app);
  registerAssistantRoutes(app);
  registerInsightRoutes(app);
  // Rate limiting is opt-in per route (config.rateLimit); the plugin must load before those routes.
  void app.register(rateLimit, { global: false });
  void app.register(async (scope) => {
    registerChatRoutes(scope);
    registerPublicRoutes(scope);
  });
  void app.register(async (scope) => registerWidgetStatic(scope, deps.config?.widgetDir));

  app.get("/healthz", async () => ({ ok: true }));
  return app;
}
