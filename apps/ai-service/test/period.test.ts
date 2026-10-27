import { describe, expect, it } from "vitest";
import { resolvePeriod } from "../src/profit/period.js";

const now = new Date("2026-10-27T05:00:00Z"); // Tue 12:00 WIB
const jkt = "Asia/Jakarta" as const;

describe("resolvePeriod", () => {
  it.each([
    ["today", "2026-10-27", "2026-10-27", "hari ini"],
    ["yesterday", "2026-10-26", "2026-10-26", "kemarin"],
    ["this_week", "2026-10-26", "2026-10-27", "minggu ini"],
    ["last_week", "2026-10-19", "2026-10-25", "minggu lalu"],
    ["this_month", "2026-10-01", "2026-10-27", "bulan ini"],
    ["last_month", "2026-09-01", "2026-09-30", "bulan lalu"],
  ] as const)("%s", (period, from, to, label) => {
    expect(resolvePeriod({ period }, jkt, now)).toEqual({ from, to, label });
  });

  it("uses local date for WIT at 00:30", () => {
    const t = new Date("2026-10-26T15:30:00Z");
    expect(resolvePeriod({ period: "today" }, "Asia/Jayapura", t)).toMatchObject({ from: "2026-10-27", to: "2026-10-27" });
    expect(resolvePeriod({ period: "today" }, jkt, t)).toMatchObject({ from: "2026-10-26", to: "2026-10-26" });
  });

  it("last_month across a year boundary (S3)", () => {
    const jan = new Date("2026-01-15T05:00:00Z");
    expect(resolvePeriod({ period: "last_month" }, jkt, jan)).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("uses local date for WITA (Asia/Makassar) after its midnight (S3)", () => {
    const t = new Date("2026-10-26T16:30:00Z"); // 00:30 WITA on 2026-10-27
    expect(resolvePeriod({ period: "today" }, "Asia/Makassar", t)).toMatchObject({ from: "2026-10-27", to: "2026-10-27" });
  });

  it("week starts Monday when today is Monday", () => {
    const mon = new Date("2026-10-26T05:00:00Z");
    expect(resolvePeriod({ period: "this_week" }, jkt, mon)).toMatchObject({ from: "2026-10-26", to: "2026-10-26" });
  });

  it("custom valid", () => {
    expect(resolvePeriod({ period: "custom", start_date: "2026-10-01", end_date: "2026-10-10" }, jkt, now)).toEqual({
      from: "2026-10-01",
      to: "2026-10-10",
      label: "2026-10-01 s.d. 2026-10-10",
    });
  });

  it("custom accepts exactly 92 days", () => {
    expect("error" in resolvePeriod({ period: "custom", start_date: "2026-07-28", end_date: "2026-10-27" }, jkt, now)).toBe(false);
  });

  it.each([
    ["93 days", "2026-07-27", "2026-10-27"],
    ["future end", "2026-10-20", "2026-10-28"],
    ["end before start", "2026-10-10", "2026-10-01"],
    ["impossible day", "2026-02-30", "2026-03-05"],
    ["impossible month", "2026-13-01", "2026-10-01"],
  ])("custom rejects %s", (_n, start_date, end_date) => {
    const r = resolvePeriod({ period: "custom", start_date, end_date }, jkt, now);
    expect(r).toHaveProperty("error");
  });
});
