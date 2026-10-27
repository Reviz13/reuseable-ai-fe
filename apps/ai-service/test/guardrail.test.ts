import { describe, expect, it } from "vitest";
import type { ProfitReport } from "@ai/contracts";
import { applyProfitGuardrail } from "../src/profit/guardrail.js";

const base: ProfitReport = {
  sales: 4250000,
  cogs: 1700000,
  profit: 2550000,
  transactions: 312,
  missing_cost_items: 3,
  currency: "IDR",
  from: "2026-10-20",
  to: "2026-10-26",
  as_of: "2026-10-27T05:00:00.000Z",
};
const NOTE = "Catatan: profit belum memperhitungkan 3 item tanpa HPP.";
const rep = [{ report: base, label: "minggu ini" }];
const loss = [{ report: { ...base, profit: -250000 }, label: "minggu ini" }];

describe("applyProfitGuardrail", () => {
  it("returns input unchanged with no reports", () => {
    expect(applyProfitGuardrail("Profit Rp1", [])).toEqual({ text: "Profit Rp1", replaced: false });
  });
  it("passes matching text and appends the missing-HPP note", () => {
    const r = applyProfitGuardrail("Profit minggu ini Rp2.550.000 dari 312 transaksi (naik 12%) per 27/10.", rep);
    expect(r.replaced).toBe(false);
    expect(r.text.startsWith("Profit minggu ini Rp2.550.000")).toBe(true);
    expect(r.text.endsWith(NOTE)).toBe(true);
  });
  it("replaces mismatching text with the template and note", () => {
    const r = applyProfitGuardrail("Profit Rp2.600.000", rep);
    expect(r.replaced).toBe(true);
    expect(r.text).toBe(
      "Profit minggu ini (2026-10-20 s.d. 2026-10-26): Rp2.550.000. Penjualan Rp4.250.000, HPP Rp1.700.000, 312 transaksi.\n" + NOTE,
    );
  });
  it("accepts jt amounts within 0.5% but not rb or Rp amounts", () => {
    expect(applyProfitGuardrail("sekitar 2,55 jt", rep).replaced).toBe(false);
    expect(applyProfitGuardrail("sekitar 2,56 jt", rep).replaced).toBe(false);
    expect(applyProfitGuardrail("sekitar 2,6 jt", rep).replaced).toBe(true);
    expect(applyProfitGuardrail("Rp2.551.000", rep).replaced).toBe(true);
    expect(applyProfitGuardrail("2550 rb", rep).replaced).toBe(false);
    expect(applyProfitGuardrail("2551 rb", rep).replaced).toBe(true);
  });
  it("accepts losses written as rugi or minus", () => {
    expect(applyProfitGuardrail("Minggu ini rugi Rp250.000", loss).replaced).toBe(false);
    expect(applyProfitGuardrail("-Rp250.000", loss).replaced).toBe(false);
    expect(applyProfitGuardrail("Rp -250.000", loss).replaced).toBe(false);
    expect(applyProfitGuardrail("Profit Rp250.000", loss).replaced).toBe(true);
  });
  it("rejects a rugi sign error (no absolute-value match)", () => {
    expect(applyProfitGuardrail("rugi Rp2.550.000", rep).replaced).toBe(true);
    expect(applyProfitGuardrail("Minggu ini rugi Rp250.000", loss).replaced).toBe(false);
  });
  it("checks US-style grouped amounts", () => {
    expect(applyProfitGuardrail("Rp2,600,000", rep).replaced).toBe(true);
    expect(applyProfitGuardrail("Rp 2,600,000.00", rep).replaced).toBe(true);
    expect(applyProfitGuardrail("IDR 2,600,000", rep).replaced).toBe(true);
    expect(applyProfitGuardrail("Rp2,550,000", rep).replaced).toBe(false);
    expect(applyProfitGuardrail("Rp 2,550,000.00", rep).replaced).toBe(false);
  });
  it("checks the rupiah suffix exactly", () => {
    expect(applyProfitGuardrail("2.600.000 rupiah", rep).replaced).toBe(true);
    expect(applyProfitGuardrail("2.550.000 rupiah", rep).replaced).toBe(false);
    expect(applyProfitGuardrail("2.551.000 Rupiah", rep).replaced).toBe(true);
  });
  it("accepts jutaan with tolerance", () => {
    expect(applyProfitGuardrail("sekitar 2,55 jutaan", rep).replaced).toBe(false);
    expect(applyProfitGuardrail("sekitar 2,7 jutaan", rep).replaced).toBe(true);
  });
  it.each(["Rp2.600.0000", "Rp2.600.000.50", "Rp2.600.000,5,5"])("fails closed on malformed %s", (s) => {
    expect(applyProfitGuardrail(`Profit ${s}`, rep).replaced).toBe(true);
  });
  it("still ignores non-rupiah numbers", () => {
    expect(applyProfitGuardrail("312 transaksi, naik 12%, 2026-10-20 s.d. 2026-10-26", rep).replaced).toBe(false);
  });
  it("does not replace text with no amounts but still appends the note", () => {
    const r = applyProfitGuardrail("Tidak ada angka rupiah, 312 transaksi.", rep);
    expect(r.replaced).toBe(false);
    expect(r.text.endsWith(NOTE)).toBe(true);
  });
  it("treats Rp 0 as an amount that must match a report value", () => {
    expect(applyProfitGuardrail("Rp 0", rep).replaced).toBe(true);
    const zero = [{ report: { ...base, profit: 0, missing_cost_items: 0 }, label: "hari ini" }];
    expect(applyProfitGuardrail("Profit Rp 0", zero).replaced).toBe(false);
  });
  it("omits note when no missing cost items", () => {
    const r = applyProfitGuardrail("Profit Rp2.550.000", [{ report: { ...base, missing_cost_items: 0 }, label: "minggu ini" }]);
    expect(r).toEqual({ text: "Profit Rp2.550.000", replaced: false });
  });
  it("does not append the note twice", () => {
    const r = applyProfitGuardrail(`Profit Rp2.550.000\n${NOTE}`, rep);
    expect(r.text.split(NOTE).length).toBe(2);
  });
  it("matches against any of several reports and emits all templates on replacement", () => {
    const last = { ...base, profit: 1000000, sales: 3000000, cogs: 2000000, transactions: 200, missing_cost_items: 0, from: "2026-10-13", to: "2026-10-19" };
    const two = [rep[0]!, { report: last, label: "minggu lalu" }];
    expect(applyProfitGuardrail("Minggu lalu Rp1.000.000, minggu ini Rp2.550.000", two).replaced).toBe(false);
    const r = applyProfitGuardrail("Rp9.999.999", two);
    expect(r.replaced).toBe(true);
    const lines = r.text.split("\n");
    expect(lines[0]).toContain("Profit minggu ini (2026-10-20 s.d. 2026-10-26): Rp2.550.000.");
    expect(lines[1]).toBe("Profit minggu lalu (2026-10-13 s.d. 2026-10-19): Rp1.000.000. Penjualan Rp3.000.000, HPP Rp2.000.000, 200 transaksi.");
    expect(lines[2]).toBe(NOTE);
    expect(lines).toHaveLength(3);
  });
});
