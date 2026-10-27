import { describe, expect, it } from "vitest";
import { formatRupiah, parseRupiahAmounts } from "../src/money.js";

describe("formatRupiah", () => {
  it.each([
    [1250000, "Rp1.250.000"],
    [0, "Rp0"],
    [999, "Rp999"],
    [1000, "Rp1.000"],
    [-250000, "-Rp250.000"],
    [2550000.4, "Rp2.550.000"],
    [-0.2, "Rp0"],
    [1500000000, "Rp1.500.000.000"],
  ])("formats %s as %s", (n, out) => expect(formatRupiah(n)).toBe(out));
});

describe("parseRupiahAmounts", () => {
  it("parses Rp with decimal comma and miliar", () => {
    expect(parseRupiahAmounts("Rp 1.250.000,00 dan 1,5 miliar")).toEqual([1250000, 1500000000]);
  });
  it.each([
    ["Rp1.250.000", 1250000],
    ["rp1.250.000", 1250000],
    ["RP 1.250.000", 1250000],
    ["IDR 1.250.000", 1250000],
    ["idr1.250.000", 1250000],
    ["1,25 jt", 1250000],
    ["1.25 juta", 1250000],
    ["2,55jt", 2550000],
    ["1,5 miliar", 1500000000],
    ["250 rb", 250000],
    ["250 ribu", 250000],
    ["1.250 juta", 1250000000],
    ["Rp1.250.000,50", 1250000.5],
    ["Rp 0", 0],
    ["-Rp250.000", -250000],
    ["- Rp 250.000", -250000],
    ["Rp -250.000", -250000],
    ["rugi Rp250.000", -250000],
    ["Rugi sebesar Rp250.000", -250000],
  ])("parses %j as %s", (text, n) => expect(parseRupiahAmounts(text)).toEqual([n]));

  it("ignores bare numbers, percentages and dates", () => {
    expect(parseRupiahAmounts("312 transaksi, naik 12% per 27/10 (2026-10-20 s.d. 2026-10-26)")).toEqual([]);
  });
  it("handles sentence-ending dot after amount", () => {
    expect(parseRupiahAmounts("Profit Rp2.550.000.")).toEqual([2550000]);
  });
  it("rugi only negates the amount directly following it", () => {
    expect(parseRupiahAmounts("rugi Rp250.000 dan penjualan Rp4.250.000")).toEqual([-250000, 4250000]);
  });
  it("does not treat words ending in rp as a currency prefix", () => {
    expect(parseRupiahAmounts("Corp 5")).toEqual([]);
  });
});
