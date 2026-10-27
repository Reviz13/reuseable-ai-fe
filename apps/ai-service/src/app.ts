import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
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
import { registerKnowledgeRoutes } from "./admin/knowledge.js";

export interface AppDeps {
  config: Config;
  db: Db;
  blob: BlobStore;
  verifyEndUser: EndUserVerifier;
  verifyAdmin: AdminVerifier;
  now: () => Date;
  // Placeholders, tightened by later tasks.
  gatewayFor?: unknown;
  embedder?: Embedder;
  pos?: unknown;
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

export function createApp(deps: AppDeps, opts: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({
    logger: opts.logger
      ? { redact: ["req.headers.authorization", "req.headers['x-internal-key']"] }
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
      const seg = /^\/v1\/([^/?]+)/.exec(url)?.[1];
      const parsedApp = AppIdSchema.safeParse(seg);
      if (!origin || !parsedApp.success) return cb(null, { origin: false });
      const appId = parsedApp.data;
      corsLookup.allowedOrigins(appId).then(
        (allowed) => cb(null, { origin: allowed.includes(origin), credentials: false }),
        (err) => cb(err as Error, { origin: false }),
      );
    },
  });

  app.setErrorHandler((err: Error, _req, reply) => {
    if (err instanceof AuthError) return reply.code(401).send({ error: "unauthorized" });
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

  app.get("/healthz", async () => ({ ok: true }));
  return app;
}
