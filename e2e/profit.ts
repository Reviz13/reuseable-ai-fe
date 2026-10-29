import { resolve } from "node:path";

/** E2E_EXTERNAL=1 (pnpm test:e2e against a running `pnpm dev`): the .env INTERNAL_KEY; otherwise the local stack key. */
export const E2E_INTERNAL_KEY = process.env.E2E_EXTERNAL === "1" ? (process.env.INTERNAL_KEY ?? "dev") : "e2e";
export const MOCK_POS = "http://localhost:4100";
export const OUTLET_ID = "kopi-tepi-01";
export const PROFIT_QUESTION = "Profit this week?";
export const FAKE_SCRIPT_PATH = resolve(__dirname, "fake-script.json");

const pad = (n: number) => String(n).padStart(2, "0");

/** this_week in Asia/Jakarta (UTC+7, no DST), Monday start, to = today. Mirrors ai-service resolvePeriod. */
export function thisWeekJakarta(now = new Date()): { from: string; to: string } {
  const local = new Date(now.getTime() + 7 * 3_600_000);
  const today = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const offset = (new Date(today).getUTCDay() + 6) % 7;
  const fmt = (ms: number) => {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  };
  return { from: fmt(today - offset * 86_400_000), to: fmt(today) };
}

/** Same rules as ai-service formatRupiah: Rp + id-ID thousands dots, no decimals. */
export function formatRupiah(n: number): string {
  const r = Math.round(Math.abs(n));
  return `${n < 0 && r !== 0 ? "-" : ""}Rp${String(r).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

/**
 * Matches an amount however the answer writes it: "Rp3.482.000" (id), "Rp3,482,000" (en), or a live model's
 * "Rp 3,482,000" / "IDR 3,482,000". The digits must be exact.
 */
export function rupiahPattern(n: number): RegExp {
  const groups = String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, " ").split(" ");
  return new RegExp(`${n < 0 ? "-" : ""}(?:Rp|IDR)\\s?${groups.join("[.,]")}(?!\\d)`);
}

/** Profit straight from mock-pos for the resolved this_week range. */
export async function fetchThisWeekProfit(): Promise<{ profit: number; from: string; to: string }> {
  const { from, to } = thisWeekJakarta();
  const url = `${MOCK_POS}/internal/reports/profit?outlet_id=${OUTLET_ID}&from=${from}&to=${to}`;
  const res = await fetch(url, { headers: { "x-internal-key": E2E_INTERNAL_KEY } });
  if (!res.ok) throw new Error(`mock-pos profit ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { profit: number };
  return { profit: body.profit, from, to };
}
