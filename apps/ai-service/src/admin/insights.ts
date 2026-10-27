import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppIdSchema, AuditQuerySchema } from "@ai/contracts";
import { createAuditWriter } from "../audit.js";
import { HttpError, parseRequest } from "../http.js";

const LIMIT = 200;
const UuidSchema = z.string().uuid();
const BoolQuery = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");
const RatingQuery = z.enum(["-1", "1"]).default("-1").transform(Number);
const DaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)));
const AuditFilterSchema = AuditQuerySchema.extend({ from: DaySchema.optional(), to: DaySchema.optional() });

export function registerInsightRoutes(app: FastifyInstance): void {
  const db = app.deps.db;
  const audit = createAuditWriter(db);

  for (const appId of AppIdSchema.options) {
    const guard = { preHandler: app.requireAdmin(appId) };

    app.get<{ Querystring: { resolved?: string } }>(`/admin/${appId}/gaps`, guard, async (req) => {
      const resolved = parseRequest(BoolQuery, req.query.resolved);
      return db.query(
        `select id, question, top_score, created_at, resolved_at from knowledge_gaps
         where app = $1 and (resolved_at is not null) = $2
         order by created_at desc, id limit ${LIMIT}`,
        [appId, resolved],
      );
    });

    app.post<{ Params: { id: string } }>(`/admin/${appId}/gaps/:id/resolve`, guard, async (req) => {
      const started = Date.now();
      if (!UuidSchema.safeParse(req.params.id).success) throw new HttpError(404, "not found");
      const [gap] = await db.query<{ id: string; resolved_at: string }>(
        "update knowledge_gaps set resolved_at = now() where id = $1 and app = $2 returning id, resolved_at",
        [req.params.id, appId],
      );
      if (!gap) throw new HttpError(404, "not found");
      await audit({
        app: appId,
        actor_type: "admin",
        actor_id: req.admin.user_id,
        action: "gap.resolve",
        params: { gap_id: gap.id },
        outcome: "ok",
        duration_ms: Date.now() - started,
      });
      return gap;
    });

    app.get<{ Querystring: { rating?: string } }>(`/admin/${appId}/feedback`, guard, async (req) => {
      const rating = parseRequest(RatingQuery, req.query.rating);
      return db.query(
        `select f.message_id, f.rating, f.comment, f.created_at, m.content as answer,
                (select u.content from messages u
                  where u.conversation_id = m.conversation_id and u.role = 'user' and u.created_at < m.created_at
                  order by u.created_at desc limit 1) as question
         from feedback f
         join messages m on m.id = f.message_id
         join conversations c on c.id = m.conversation_id
         where c.app = $1 and f.rating = $2
         order by f.created_at desc, f.message_id limit ${LIMIT}`,
        [appId, rating],
      );
    });

    app.get(`/admin/${appId}/audit`, guard, async (req) => {
      const q = parseRequest(AuditFilterSchema, req.query);
      return db.query(
        `select id, at, app, actor_type, actor_id, outlet_id, action, params, outcome, error_code, duration_ms
         from audit_log
         where app = $1
           and ($2::text is null or action = $2)
           and ($3::text is null or outcome = $3)
           and ($4::text is null or at >= ($4::date)::timestamptz)
           and ($5::text is null or at < (($5::date) + 1)::timestamptz)
         order by at desc, id limit $6`,
        [appId, q.action ?? null, q.outcome ?? null, q.from ?? null, q.to ?? null, q.limit],
      );
    });
  }
}
