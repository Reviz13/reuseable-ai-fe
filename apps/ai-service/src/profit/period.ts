import { TZDate } from "@date-fns/tz";
import type { GetProfitArgs, Tz } from "@ai/contracts";
import { copyFor, type Copy } from "../copy.js";

export type ResolvedPeriod = { from: string; to: string; label: string };
export type PeriodError = { error: string };

const MAX_DAYS = 92;
const DAY_MS = 86_400_000;

const pad = (n: number) => String(n).padStart(2, "0");
const fmt = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);

function parseStrict(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = utc(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return fmt(d) === s ? d : null;
}

/** Resolve a profit period to local calendar dates in `tz`. Weeks start on Monday. */
export function resolvePeriod(
  args: GetProfitArgs,
  tz: Tz,
  now: Date,
  copy: Copy = copyFor("id"),
): ResolvedPeriod | PeriodError {
  const local = new TZDate(now, tz);
  const today = utc(local.getFullYear(), local.getMonth(), local.getDate());
  const ymd = (from: Date, to: Date, label: string): ResolvedPeriod => ({ from: fmt(from), to: fmt(to), label });

  switch (args.period) {
    case "today":
      return ymd(today, today, copy.period.today);
    case "yesterday": {
      const y = addDays(today, -1);
      return ymd(y, y, copy.period.yesterday);
    }
    case "this_week": {
      const offset = (today.getUTCDay() + 6) % 7; // Monday = 0
      return ymd(addDays(today, -offset), today, copy.period.this_week);
    }
    case "last_week": {
      const monday = addDays(today, -((today.getUTCDay() + 6) % 7));
      return ymd(addDays(monday, -7), addDays(monday, -1), copy.period.last_week);
    }
    case "this_month":
      return ymd(utc(today.getUTCFullYear(), today.getUTCMonth(), 1), today, copy.period.this_month);
    case "last_month": {
      const first = utc(today.getUTCFullYear(), today.getUTCMonth(), 1);
      return ymd(utc(first.getUTCFullYear(), first.getUTCMonth() - 1, 1), addDays(first, -1), copy.period.last_month);
    }
    case "custom": {
      if (!args.start_date || !args.end_date) return { error: "start_date dan end_date wajib diisi" };
      const s = parseStrict(args.start_date);
      const e = parseStrict(args.end_date);
      if (!s || !e) return { error: "tanggal tidak valid" };
      if (e < s) return { error: "tanggal akhir sebelum tanggal awal" };
      if (e > today) return { error: "tanggal akhir tidak boleh di masa depan" };
      const days = Math.round((e.getTime() - s.getTime()) / DAY_MS) + 1;
      if (days > MAX_DAYS) return { error: `rentang maksimal ${MAX_DAYS} hari` };
      return ymd(s, e, copy.customPeriod(fmt(s), fmt(e)));
    }
  }
}
