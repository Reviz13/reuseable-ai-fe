import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/demo-dashboard/route";

const req = (qs: string) => new Request("http://studio.test/api/demo-dashboard?" + qs);

const day = (date: string, sales: number, cogs: number, transactions: number) => ({
  date, sales, cogs, profit: sales - cogs, transactions, missing_cost_items: 1,
});
const report = (days: ReturnType<typeof day>[]) => ({
  days,
  products: [{ name: "Cappuccino", qty: 3, sales: 84000 }],
  payments: [{ method: "cash", transactions: 3, sales: 84000 }],
  currency: "IDR", from: days[0]!.date, to: days[days.length - 1]!.date, as_of: "x",
});

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  // 2026-10-28 23:30 UTC is already 2026-10-29 in Jakarta.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-28T23:30:00Z"));
  vi.stubEnv("MOCK_POS_URL", "http://pos.test:4100/");
  vi.stubEnv("POS_INTERNAL_KEY", "k-123");
  fetchMock = vi.fn(async (url: string) => {
    const u = new URL(url);
    return Response.json(
      u.searchParams.get("from") === "2026-10-23"
        ? report([day("2026-10-23", 100, 40, 2), day("2026-10-29", 300, 100, 4)])
        : report([day("2026-10-16", 50, 20, 1), day("2026-10-22", 150, 60, 3)]),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("GET /api/demo-dashboard", () => {
  it("asks mock-pos for the Jakarta-dated range and the one before it, with the internal key", async () => {
    const res = await GET(req("role=owner&range=7d"));
    expect(res.status).toBe(200);
    const urls = fetchMock.mock.calls.map((c) => new URL(c[0] as string));
    expect(urls.map((u) => [u.pathname, u.searchParams.get("from"), u.searchParams.get("to")])).toEqual([
      ["/internal/reports/daily", "2026-10-23", "2026-10-29"],
      ["/internal/reports/daily", "2026-10-16", "2026-10-22"],
    ]);
    expect(urls[0]!.searchParams.get("outlet_id")).toBe("kopi-tepi-01");
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).toEqual({ "x-internal-key": "k-123" });
    const body = await res.json();
    expect(body.totals).toEqual({ sales: 400, cogs: 140, profit: 260, transactions: 6, missing_cost_items: 2 });
    expect(body.previous).toEqual({ sales: 200, cogs: 80, profit: 120, transactions: 4, missing_cost_items: 2 });
    expect(body.days).toHaveLength(2);
    expect(body.products[0].name).toBe("Cappuccino");
    expect(JSON.stringify(body)).not.toContain("k-123");
  });

  it("today compares with yesterday", async () => {
    await GET(req("role=owner&range=today"));
    const urls = fetchMock.mock.calls.map((c) => new URL(c[0] as string));
    expect(urls.map((u) => [u.searchParams.get("from"), u.searchParams.get("to")])).toEqual([
      ["2026-10-29", "2026-10-29"],
      ["2026-10-28", "2026-10-28"],
    ]);
  });

  it("refuses the cashier role (owner-only, like the assistant) without calling mock-pos", async () => {
    const res = await GET(req("role=cashier&range=7d"));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("400 on an unknown range or role", async () => {
    expect((await GET(req("role=owner&range=year"))).status).toBe(400);
    expect((await GET(req("role=boss&range=7d"))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("502 when mock-pos fails, 404 in production unless DEMO_ENABLED=1", async () => {
    fetchMock.mockResolvedValueOnce(new Response("no", { status: 500 }));
    expect((await GET(req("role=owner&range=7d"))).status).toBe(502);
    vi.stubEnv("NODE_ENV", "production");
    expect((await GET(req("role=owner&range=7d"))).status).toBe(404);
  });
});
