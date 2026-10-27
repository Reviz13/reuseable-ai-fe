import Fastify, { type FastifyInstance } from "fastify";
import { SignJWT } from "jose";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { OUTLET_ID, dailyTotals } from "./data";
import type { Keys } from "./keys";

export interface ServerDeps {
  keys: Keys;
  internalKey: string;
  now: () => Date;
}

const MAX_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;

function parseDate(s: unknown): number | null {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const ms = Date.parse(`${s}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10) === s ? ms : null; // rejects 2026-02-30
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

const ROLES = { owner: "u-owner", cashier: "u-cashier" } as const;

export function buildServer({ keys, internalKey, now }: ServerDeps): FastifyInstance {
  const app = Fastify();

  app.get("/internal/reports/profit", async (req, reply) => {
    const h = req.headers["x-internal-key"];
    if (typeof h !== "string" || !safeEqual(h, internalKey)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const q = req.query as Record<string, unknown>;
    if (q.outlet_id !== OUTLET_ID) return reply.code(404).send({ error: "unknown outlet" });
    const from = parseDate(q.from), to = parseDate(q.to);
    if (from === null || to === null) return reply.code(400).send({ error: "from/to must be real YYYY-MM-DD dates" });
    if (from > to) return reply.code(400).send({ error: "from must not be after to" });
    if ((to - from) / DAY_MS + 1 > MAX_RANGE_DAYS) {
      return reply.code(400).send({ error: `range exceeds ${MAX_RANGE_DAYS} days` });
    }
    let sales = 0, cogs = 0, transactions = 0, missing = 0;
    for (let t = from; t <= to; t += DAY_MS) {
      const d = dailyTotals(OUTLET_ID, new Date(t).toISOString().slice(0, 10));
      sales += d.sales; cogs += d.cogs; transactions += d.transactions; missing += d.missing_cost_items;
    }
    return {
      sales, cogs, profit: sales - cogs, transactions, missing_cost_items: missing,
      currency: "IDR", from: q.from, to: q.to, as_of: now().toISOString(),
    };
  });

  app.post("/token", async (req, reply) => {
    const role = (req.body as { role?: unknown } | null)?.role;
    if (role !== "owner" && role !== "cashier") return reply.code(400).send({ error: "role must be owner|cashier" });
    const iat = Math.floor(now().getTime() / 1000);
    const jwt = await new SignJWT({ outlet_id: OUTLET_ID, role, tz: "Asia/Jakarta" })
      .setProtectedHeader({ alg: "RS256", kid: keys.kid })
      .setIssuer("pos")
      .setAudience("ai-platform")
      .setSubject(ROLES[role])
      .setJti(randomUUID())
      .setIssuedAt(iat)
      .setExpirationTime(iat + 600)
      .sign(keys.privateKey);
    return reply.type("text/plain").send(jwt);
  });

  app.get("/.well-known/jwks.json", async () => ({ keys: [keys.publicJwk] }));

  return app;
}

/**
 * M2: mock-pos listens on MOCK_POS_PORT (default 4100). It never reads PORT, which the shared root
 * .env sets to 4000 for ai-service.
 */
export function mockPosPort(env: Record<string, string | undefined>): number {
  const raw = env.MOCK_POS_PORT;
  return raw ? Number(raw) : 4100;
}
