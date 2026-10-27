/**
 * POS eval runner: `pnpm eval` (root; loads .env). Needs the `pnpm dev` stack running with a real LLM key.
 *
 * Env (all optional, defaults in brackets):
 *   AI_SERVICE_URL [http://localhost:4000], MOCK_POS_URL [http://localhost:4100], INTERNAL_KEY [dev]
 *   EVAL_ADMIN_EMAIL / EVAL_ADMIN_PASSWORD (fallback SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD) + SUPABASE_URL /
 *   SUPABASE_ANON_KEY: admin token to upload evals/knowledge/*.md when missing and to read the audit log
 *   (period checks). Without them: knowledge upload and period checks are skipped with a warning.
 *   EVAL_ONLY=<id prefix>[,<id prefix>...] runs a subset.
 *
 * Exit 1 when overall < 90% or any numbers_match_tool / refusal case fails.
 */
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { resolvePeriod } from "../apps/ai-service/src/profit/period.js";
import {
  formatTable,
  parseSse,
  scoreCase,
  summarize,
  type CaseContext,
  type CaseResult,
  type EvalCase,
  type ProfitPeriod,
  type Report,
} from "./score.js";

const here = dirname(fileURLToPath(import.meta.url));
const AI = (process.env.AI_SERVICE_URL ?? "http://localhost:4000").replace(/\/+$/, "");
const POS = (process.env.MOCK_POS_URL ?? "http://localhost:4100").replace(/\/+$/, "");
const INTERNAL_KEY = process.env.INTERNAL_KEY ?? process.env.POS_INTERNAL_KEY ?? "dev";
const OUTLET_ID = "kopi-tepi-01";
const TZ = "Asia/Jakarta";
const APP = "pos";
// 20 messages/min per (app, sub): keep each role under it.
const MIN_GAP_MS = 3_200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadCases(): EvalCase[] {
  const only = process.env.EVAL_ONLY?.split(",").map((s) => s.trim()).filter(Boolean);
  return readFileSync(join(here, "pos.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as EvalCase)
    .filter((c) => !only?.length || only.some((p) => c.id.startsWith(p)));
}

async function posToken(role: "owner" | "cashier"): Promise<string> {
  const res = await fetch(`${POS}/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) throw new Error(`mock-pos /token ${role}: ${res.status}`);
  return res.text();
}

async function posReport(from: string, to: string): Promise<Report> {
  const res = await fetch(`${POS}/internal/reports/profit?outlet_id=${OUTLET_ID}&from=${from}&to=${to}`, {
    headers: { "x-internal-key": INTERNAL_KEY },
  });
  if (!res.ok) throw new Error(`mock-pos profit ${from}..${to}: ${res.status}`);
  return (await res.json()) as Report;
}

async function adminToken(): Promise<string | null> {
  const email = process.env.EVAL_ADMIN_EMAIL ?? process.env.SEED_ADMIN_EMAIL;
  const password = process.env.EVAL_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD;
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!email || !password || !url || !anon) return null;
  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    console.warn(`WARN admin sign-in failed: ${error?.message ?? "no session"}`);
    return null;
  }
  return data.session.access_token;
}

async function adminGet<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${AI}${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
  return (await res.json()) as T;
}

/** Uploads evals/knowledge/*.md whose filename is not yet a document title, then waits for `ready`. */
async function ensureKnowledge(token: string): Promise<void> {
  const dir = join(here, "knowledge");
  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  type Doc = { id: string; title: string; status: string };
  const docs = await adminGet<Doc[]>(token, `/admin/${APP}/documents`);
  const titles = new Set(docs.map((d) => d.title));
  for (const f of files.filter((f) => !titles.has(f))) {
    const form = new FormData();
    form.append("file", new Blob([readFileSync(join(dir, f))], { type: "text/markdown" }), f);
    const res = await fetch(`${AI}/admin/${APP}/documents`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
    console.log(`upload ${f}: ${res.status}`);
    if (!res.ok) throw new Error(`upload ${f} failed: ${res.status} ${await res.text()}`);
  }
  const deadline = Date.now() + 180_000;
  for (;;) {
    const now = await adminGet<Doc[]>(token, `/admin/${APP}/documents`);
    const mine = now.filter((d) => files.includes(basename(d.title)));
    const failed = mine.filter((d) => d.status === "failed");
    if (failed.length) throw new Error(`knowledge ingestion failed: ${failed.map((d) => d.title).join(", ")}`);
    if (mine.length >= files.length && mine.every((d) => d.status === "ready")) return;
    if (Date.now() > deadline) throw new Error("knowledge not ready after 180 s");
    await sleep(2_000);
  }
}

async function chat(token: string, message: string): Promise<{ status: number; body: string }> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${AI}/v1/chat`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ app: APP, message }),
    });
    if (res.status === 429 && attempt < 6) {
      await sleep(10_000);
      continue;
    }
    return { status: res.status, body: await res.text() };
  }
}

type AuditRow = { at: string; actor_id: string; params: { period?: ProfitPeriod; from?: string; to?: string } | null };

async function lastProfitAudit(token: string, sub: string, since: number): Promise<AuditRow | null> {
  const rows = await adminGet<AuditRow[]>(token, `/admin/${APP}/audit?action=tool.get_profit&limit=20`);
  return rows.find((r) => r.actor_id === sub && Date.parse(r.at) >= since - 1_000) ?? null;
}

function subOf(jwt: string): string {
  return (JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString("utf8")) as { sub: string }).sub;
}

async function main(): Promise<void> {
  const cases = loadCases();
  const admin = await adminToken();
  if (admin) {
    await ensureKnowledge(admin);
  } else {
    console.warn(
      "WARN no admin credentials (EVAL_ADMIN_EMAIL/PASSWORD or SEED_ADMIN_EMAIL/PASSWORD + SUPABASE_URL/ANON_KEY):\n" +
        "     evals/knowledge/*.md were NOT uploaded (sop/inject cases need them) and period checks are not scored.",
    );
  }

  const tokens = { owner: await posToken("owner"), cashier: await posToken("cashier") };
  const lastSent = { owner: 0, cashier: 0 };
  const results: CaseResult[] = [];

  for (const c of cases) {
    const wait = lastSent[c.role] + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    const started = Date.now();
    lastSent[c.role] = started;
    let { status, body } = await chat(tokens[c.role], c.question);
    if (status === 401) {
      tokens[c.role] = await posToken(c.role); // 10-minute TTL
      ({ status, body } = await chat(tokens[c.role], c.question));
    }
    const events = status === 200 ? parseSse(body) : [];

    const ctx: CaseContext = {};
    if (admin && c.expect.period) {
      const row = await lastProfitAudit(admin, subOf(tokens[c.role]), started);
      ctx.auditedPeriod = row?.params?.period ?? null;
      if (c.expect.numbers_match_tool && row?.params?.from && row.params.to) {
        ctx.report = await posReport(row.params.from, row.params.to);
      }
    }
    if (c.expect.numbers_match_tool && !ctx.report && c.expect.period) {
      const p = resolvePeriod(
        { period: c.expect.period, start_date: c.expect.start_date, end_date: c.expect.end_date } as never,
        TZ,
        new Date(started),
      );
      if (!("error" in p)) ctx.report = await posReport(p.from, p.to);
    }

    const r = scoreCase(c, events, ctx);
    if (status !== 200) r.checks.unshift({ name: "http", pass: false, detail: `HTTP ${status}: ${body.slice(0, 200)}` });
    if (status !== 200) r.pass = false;
    results.push(r);
    const failed = r.checks.filter((ch) => ch.pass === false);
    console.log(`${r.pass ? "PASS" : "FAIL"} ${c.id}${failed.length ? "  " + failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`).join("; ") : ""}`);
    if (!r.pass) console.log(`     answer: ${r.text.replace(/\s+/g, " ").slice(0, 300)}`);
  }

  const s = summarize(results);
  console.log("\n" + formatTable(s));
  process.exitCode = s.exitCode;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
