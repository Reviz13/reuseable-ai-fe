import type { Db } from "./db.js";

export interface AuditEntry {
  app: string;
  actor_type: "end_user" | "admin";
  actor_id?: string;
  outlet_id?: string;
  action: string;
  params: unknown;
  outcome: "ok" | "forbidden" | "error";
  error_code?: string;
  duration_ms: number;
}

export type AuditWriter = (e: AuditEntry) => Promise<void>;

/** Appends to audit_log. Failures are logged and never thrown: auditing must not break a user request. */
export function createAuditWriter(
  db: Db,
  logger: (msg: string, err: unknown) => void = (msg, err) => console.error(msg, err),
): AuditWriter {
  return async (e) => {
    try {
      await db.query(
        `insert into audit_log (app, actor_type, actor_id, outlet_id, action, params, outcome, error_code, duration_ms)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
        [
          e.app,
          e.actor_type,
          e.actor_id ?? null,
          e.outlet_id ?? null,
          e.action,
          JSON.stringify(e.params ?? null),
          e.outcome,
          e.error_code ?? null,
          e.duration_ms,
        ],
      );
    } catch (err) {
      try {
        logger("audit write failed", err);
      } catch {
        /* logger must not throw either */
      }
    }
  };
}
