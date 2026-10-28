// Demo only: owner dashboard numbers from mock-pos. The internal key stays on the server; disabled in
// production unless DEMO_ENABLED=1, like /api/demo-token.
export const dynamic = "force-dynamic";

const OUTLET_ID = "kopi-tepi-01";
const RANGE_DAYS = { today: 1, "7d": 7, "30d": 30 } as const;
const DAY_MS = 86_400_000;
const JAKARTA_OFFSET_MS = 7 * 3_600_000;

type Day = { date: string; sales: number; cogs: number; profit: number; transactions: number; missing_cost_items: number };
type Report = { days: Day[]; products: unknown[]; payments: unknown[] };

/** YYYY-MM-DD for the Jakarta calendar day `back` days before today. */
function jakartaDate(back: number): string {
  return new Date(Date.now() + JAKARTA_OFFSET_MS - back * DAY_MS).toISOString().slice(0, 10);
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

export async function GET(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === "production" && process.env.DEMO_ENABLED !== "1") {
    return new Response("Not found", { status: 404 });
  }
  const params = new URL(request.url).searchParams;
  const role = params.get("role");
  const range = params.get("range") as keyof typeof RANGE_DAYS | null;
  if ((role !== "owner" && role !== "cashier") || !range || !(range in RANGE_DAYS)) {
    return new Response("role must be owner|cashier and range today|7d|30d", { status: 400 });
  }
  if (role !== "owner") return new Response("Hanya owner yang dapat melihat dashboard.", { status: 403 });

  const n = RANGE_DAYS[range];
  const base = (process.env.MOCK_POS_URL ?? "http://localhost:4100").replace(/\/+$/, "");
  const key = process.env.POS_INTERNAL_KEY ?? "";
  const load = async (from: string, to: string): Promise<Report> => {
    const qs = new URLSearchParams({ outlet_id: OUTLET_ID, from, to });
    const res = await fetch(`${base}/internal/reports/daily?${qs}`, { headers: { "x-internal-key": key }, cache: "no-store" });
    if (!res.ok) throw new Error(`mock-pos ${res.status}`);
    return (await res.json()) as Report;
  };

  let current: Report, previous: Report;
  try {
    [current, previous] = await Promise.all([load(jakartaDate(n - 1), jakartaDate(0)), load(jakartaDate(2 * n - 1), jakartaDate(n))]);
  } catch {
    return new Response("mock POS unreachable", { status: 502 });
  }
  return Response.json(
    {
      range,
      from: jakartaDate(n - 1),
      to: jakartaDate(0),
      days: current.days,
      products: current.products,
      payments: current.payments,
      totals: totals(current.days),
      previous: totals(previous.days),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
