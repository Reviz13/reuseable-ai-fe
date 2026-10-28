// Demo only: owner dashboard numbers from mock-pos. The internal key stays on the server; disabled in
// production unless DEMO_ENABLED=1, like /api/demo-token.
export const dynamic = "force-dynamic";

const OUTLET_ID = "kopi-tepi-01";
const RANGE_DAYS = { today: 1, "7d": 7, "30d": 30 } as const;
const MAX_DAYS = 92;
const DAY_MS = 86_400_000;
const JAKARTA_OFFSET_MS = 7 * 3_600_000;

type Day = { date: string; sales: number; cogs: number; profit: number; transactions: number; missing_cost_items: number };
type Report = { days: Day[]; products: unknown[]; payments: unknown[] };

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** Midnight UTC of a real YYYY-MM-DD date, else null (rejects 2026-02-30). */
function parseDate(s: string | null): number | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const ms = Date.parse(`${s}T00:00:00Z`);
  return Number.isNaN(ms) || iso(ms) !== s ? null : ms;
}

function totals(days: Day[]) {
  const t = { sales: 0, cogs: 0, profit: 0, transactions: 0, missing_cost_items: 0 };
  for (const d of days) {
    t.sales += d.sales;
    t.cogs += d.cogs;
    t.profit += d.profit;
    t.transactions += d.transactions;
    t.missing_cost_items += d.missing_cost_items;
  }
  return t;
}

const bad = (msg: string) => new Response(msg, { status: 400 });

export async function GET(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === "production" && process.env.DEMO_ENABLED !== "1") {
    return new Response("Not found", { status: 404 });
  }
  const params = new URL(request.url).searchParams;
  const role = params.get("role");
  const range = params.get("range");
  if (role !== "owner" && role !== "cashier") return bad("role must be owner or cashier");
  if (range !== "custom" && !(range && range in RANGE_DAYS)) return bad("range must be today, 7d, 30d or custom");
  if (role !== "owner") return new Response("Only the owner can view the dashboard.", { status: 403 });

  // Calendar days are Jakarta days; dates are handled as midnight-UTC numbers.
  const today = parseDate(iso(Date.now() + JAKARTA_OFFSET_MS))!;
  let from: number, to: number;
  if (range === "custom") {
    const f = parseDate(params.get("from")), t = parseDate(params.get("to"));
    if (f === null || t === null) return bad("from and to must be real YYYY-MM-DD dates");
    if (f > t) return bad("from must not be after to");
    if (t > today) return bad("to must not be in the future");
    if ((t - f) / DAY_MS + 1 > MAX_DAYS) return bad(`the range can be at most ${MAX_DAYS} days`);
    [from, to] = [f, t];
  } else {
    to = today;
    from = today - (RANGE_DAYS[range as keyof typeof RANGE_DAYS] - 1) * DAY_MS;
  }
  // The comparison period has the same length and ends the day before `from`.
  const prevTo = from - DAY_MS;
  const prevFrom = prevTo - (to - from);

  const base = (process.env.MOCK_POS_URL ?? "http://localhost:4100").replace(/\/+$/, "");
  const key = process.env.POS_INTERNAL_KEY ?? "";
  const load = async (f: number, t: number): Promise<Report> => {
    const qs = new URLSearchParams({ outlet_id: OUTLET_ID, from: iso(f), to: iso(t) });
    const res = await fetch(`${base}/internal/reports/daily?${qs}`, { headers: { "x-internal-key": key }, cache: "no-store" });
    if (!res.ok) throw new Error(`mock-pos ${res.status}`);
    return (await res.json()) as Report;
  };

  let current: Report, previous: Report;
  try {
    [current, previous] = await Promise.all([load(from, to), load(prevFrom, prevTo)]);
  } catch {
    return new Response("mock POS unreachable", { status: 502 });
  }
  return Response.json(
    {
      range,
      from: iso(from),
      to: iso(to),
      days: current.days,
      products: current.products,
      payments: current.payments,
      totals: totals(current.days),
      previous: totals(previous.days),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
