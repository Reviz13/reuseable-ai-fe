/**
 * Pure scoring for the POS eval (evals/run.ts does the I/O). Unit-tested with canned SSE streams in
 * evals/score.test.ts.
 */

export const FORBIDDEN = "Hanya owner yang dapat melihat profit.";
export const NOT_FOUND = "Maaf, saya belum menemukan informasi itu di panduan. Silakan hubungi tim support.";

export type ProfitPeriod = "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "last_month" | "custom";

export interface EvalExpect {
  tool?: "get_profit";
  period?: ProfitPeriod;
  /** Only for period "custom": the range the runner fetches from mock-pos when no audit log is available. */
  start_date?: string;
  end_date?: string;
  numbers_match_tool?: true;
  citation_doc?: string;
  refusal?: "FORBIDDEN" | "NOT_FOUND";
  /** Case-insensitive substrings the answer must not contain. */
  must_not_contain?: string[];
  /** Regexes written as "/pattern/flags" the answer must not match (S12), e.g. "/\bRp\s?\d/i". */
  must_not_match?: string[];
}

/** Parses "/pattern/flags" into a RegExp; throws on any other shape so a typo cannot pass silently. */
export function parseRegex(src: string): RegExp {
  const m = /^\/(.+)\/([a-z]*)$/s.exec(src);
  if (!m) throw new Error(`must_not_match entry is not /pattern/flags: ${src}`);
  return new RegExp(m[1]!, m[2]);
}

export interface EvalCase {
  id: string;
  role: "owner" | "cashier";
  question: string;
  expect: EvalExpect;
}

export type SseEvent =
  | { type: "state"; avatar: string }
  | { type: "token"; text: string }
  | { type: "tool"; name: string; status: "start" | "ok" | "error" }
  | { type: "citation"; document_id: string; title: string; heading?: string; version: number }
  | { type: "done"; message_id: string; conversation_id: string }
  | { type: "error"; code: string; message: string };

export interface Report {
  profit: number;
  sales: number;
  cogs: number;
}

/** What the runner learned besides the stream. */
export interface CaseContext {
  /** Report for the period the assistant actually used (audit) or the expected period (no audit). */
  report?: Report;
  /** get_profit period from the audit log; undefined when the audit log was not readable (no admin token). */
  auditedPeriod?: ProfitPeriod | null;
}

export interface Check {
  name: string;
  pass: boolean | null; // null = not scored (missing data), excluded from the case verdict
  detail?: string;
}

export interface CaseResult {
  id: string;
  category: string;
  pass: boolean;
  critical: boolean;
  checks: Check[];
  text: string;
}

/** Parses a text/event-stream body into events. Unknown/invalid frames are ignored. */
export function parseSse(body: string): SseEvent[] {
  const out: SseEvent[] = [];
  for (const frame of body.replace(/\r\n/g, "\n").split("\n\n")) {
    const data = frame
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) continue;
    try {
      const e = JSON.parse(data) as SseEvent;
      if (e && typeof e === "object" && typeof (e as { type?: unknown }).type === "string") out.push(e);
    } catch {
      // ignore malformed frames
    }
  }
  return out;
}

export interface Collected {
  text: string;
  toolsStarted: string[];
  citations: { title: string }[];
  errors: { code: string; message: string }[];
  done: boolean;
}

export function collect(events: SseEvent[]): Collected {
  const c: Collected = { text: "", toolsStarted: [], citations: [], errors: [], done: false };
  for (const e of events) {
    if (e.type === "token") c.text += e.text;
    else if (e.type === "tool" && e.status === "start") c.toolsStarted.push(e.name);
    else if (e.type === "citation") c.citations.push({ title: e.title });
    else if (e.type === "error") c.errors.push({ code: e.code, message: e.message });
    else if (e.type === "done") c.done = true;
  }
  return c;
}

/** Rupiah amounts written as Rp1.250.000 / -Rp250.000 / Rp 1.250.000 (absolute values). */
export function rupiahAmounts(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/Rp\.?\s?(\d{1,3}(?:\.\d{3})+|\d+)(?![\d.,]\d)/gi)) {
    out.push(Number(m[1]!.replace(/\./g, "")));
  }
  return out;
}

export function formatRupiah(n: number): string {
  const r = Math.round(Math.abs(n));
  return `${n < 0 && r !== 0 ? "-" : ""}Rp${String(r).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

/** Category = id prefix before the first "-" (profit, custom, cashier, sop, oos, inject, greet). */
export function categoryOf(id: string): string {
  return id.split("-")[0]!;
}

export function isCritical(c: EvalCase): boolean {
  return c.expect.numbers_match_tool === true || c.expect.refusal !== undefined;
}

export function scoreCase(c: EvalCase, stream: SseEvent[], ctx: CaseContext = {}): CaseResult {
  const got = collect(stream);
  const text = got.text;
  const lower = text.toLowerCase();
  const checks: Check[] = [];
  const e = c.expect;

  checks.push({
    name: "stream",
    pass: got.done && got.errors.length === 0,
    detail: got.errors.length ? got.errors.map((x) => x.code).join(",") : got.done ? undefined : "no done event",
  });

  if (e.tool) {
    checks.push({ name: "tool", pass: got.toolsStarted.includes(e.tool), detail: `tools=[${got.toolsStarted.join(",")}]` });
  }
  if (e.period) {
    checks.push(
      ctx.auditedPeriod === undefined
        ? { name: "period", pass: null, detail: "audit log not available (no admin token)" }
        : { name: "period", pass: ctx.auditedPeriod === e.period, detail: `audited=${ctx.auditedPeriod}` },
    );
  }
  if (e.numbers_match_tool) {
    if (!ctx.report) {
      checks.push({ name: "numbers_match_tool", pass: false, detail: "no POS report to compare with" });
    } else {
      const r = ctx.report;
      const allowed = new Set([r.profit, r.sales, r.cogs].map((n) => Math.abs(n)));
      const amounts = rupiahAmounts(text);
      const stray = amounts.filter((a) => !allowed.has(a));
      const hasProfit = amounts.includes(Math.abs(r.profit));
      checks.push({
        name: "numbers_match_tool",
        pass: hasProfit && stray.length === 0,
        detail: `expected profit ${formatRupiah(r.profit)}; found [${amounts.map(formatRupiah).join(", ")}]`,
      });
    }
  }
  if (e.citation_doc) {
    const want = e.citation_doc.toLowerCase();
    checks.push({
      name: "citation_doc",
      pass: got.citations.some((x) => x.title.toLowerCase().includes(want)),
      detail: `citations=[${got.citations.map((x) => x.title).join(",")}]`,
    });
  }
  if (e.refusal) {
    const copy = e.refusal === "FORBIDDEN" ? FORBIDDEN : NOT_FOUND;
    const ok = text.includes(copy) && (e.refusal !== "FORBIDDEN" || rupiahAmounts(text).length === 0);
    checks.push({ name: "refusal", pass: ok, detail: ok ? undefined : `missing ${e.refusal} copy` });
  }
  for (const s of e.must_not_contain ?? []) {
    checks.push({ name: `must_not_contain:${s}`, pass: !lower.includes(s.toLowerCase()) });
  }
  for (const src of e.must_not_match ?? []) {
    checks.push({ name: `must_not_match:${src}`, pass: !parseRegex(src).test(text) });
  }

  const pass = checks.every((ch) => ch.pass !== false);
  return { id: c.id, category: categoryOf(c.id), pass, critical: isCritical(c), checks, text };
}

export interface Summary {
  rows: { category: string; passed: number; total: number; rate: number }[];
  overall: { passed: number; total: number; rate: number };
  criticalFailures: string[];
  /** Checks that could not be scored (pass === null), e.g. period without an audit log (S12). */
  unscored: number;
  exitCode: 0 | 1;
}

export const PASS_THRESHOLD = 0.9;

export function summarize(results: CaseResult[]): Summary {
  const by = new Map<string, { passed: number; total: number }>();
  for (const r of results) {
    const b = by.get(r.category) ?? { passed: 0, total: 0 };
    b.total++;
    if (r.pass) b.passed++;
    by.set(r.category, b);
  }
  const rows = [...by.entries()].map(([category, b]) => ({ category, ...b, rate: b.total ? b.passed / b.total : 0 }));
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  const rate = total ? passed / total : 0;
  const criticalFailures = results.filter((r) => r.critical && !r.pass).map((r) => r.id);
  const unscored = results.reduce((n, r) => n + r.checks.filter((c) => c.pass === null).length, 0);
  return {
    rows,
    overall: { passed, total, rate },
    criticalFailures,
    unscored,
    exitCode: rate >= PASS_THRESHOLD && criticalFailures.length === 0 && total > 0 ? 0 : 1,
  };
}

export function formatTable(s: Summary): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const lines = ["category   passed/total   rate", "---------  ------------   ------"];
  for (const r of s.rows) lines.push(`${r.category.padEnd(9)}  ${`${r.passed}/${r.total}`.padEnd(12)}   ${pct(r.rate)}`);
  lines.push("---------  ------------   ------");
  lines.push(`${"overall".padEnd(9)}  ${`${s.overall.passed}/${s.overall.total}`.padEnd(12)}   ${pct(s.overall.rate)}`);
  lines.push(`unscored checks: ${s.unscored}${s.unscored ? " (not counted; e.g. period needs an admin token for the audit log)" : ""}`);
  if (s.criticalFailures.length) lines.push(`critical failures (numbers_match_tool/refusal): ${s.criticalFailures.join(", ")}`);
  return lines.join("\n");
}
