import { describe, expect, it } from "vitest";
import type { ProfitReport } from "@ai/contracts";
import {
  CURRENCY_MARKER_RE,
  CURRENCY_TAIL_RE,
  collectCandidateAmounts,
  isProfitContext,
  sentinelTrips,
  normalizeForGuardrail,
  parseGuardrailAmounts,
} from "../src/money.js";
import { applyProfitGuardrail } from "../src/profit/guardrail.js";

// Ruling 28: the guardrail parses a normalized copy, with a fail-closed backstop.

describe("normalizeForGuardrail", () => {
  it.each([
    ["ProfitRp 9.999.000", "Profit Rp 9.999.000"],
    ["totalrp9.999.000", "total rp9.999.000"],
    ["iniIDR 9.999.000.", "ini IDR 9.999.000."],
    ["Totalrp. 9.999.000", "Total rp. 9.999.000"],
    ["terpakai dan terpenting", "terpakai dan terpenting"],
    ["Corp sudah", "Corp sudah"],
  ])("normalizes %j to %j", (a, b) => expect(normalizeForGuardrail(a)).toBe(b));
});

describe("parseGuardrailAmounts", () => {
  it.each([
    ["ProfitRp 9.999.000 ya."],
    ["iniIDR 9.999.000."],
    ["Totalrp. 9.999.000"],
    ["cekRp 9.999.000"],
    ["Profit totalrp9.999.000 ya."],
    ["Profit 9.999.000 IDR"],
    ["Profit 9.999.000 Rp."],
    ["9.999.000rp"],
  ])("%j yields 9.999.000", (s) => expect(parseGuardrailAmounts(s).map((a) => a.value)).toEqual([9999000]));

  it("a spaced suffix does not swallow the prefix of the next amount", () => {
    expect(parseGuardrailAmounts("5 Rp10.000").map((a) => a.value)).toEqual([10000]);
  });

  it("ordinary words are not amounts", () => {
    expect(parseGuardrailAmounts("stok terpakai 5 dan terpenting 3, rpm 900")).toEqual([]);
  });

  it("every currency+digit position is covered by an amount (fail closed)", () => {
    expect(parseGuardrailAmounts("Rp 1.2.3.4,5,6").some((a) => Number.isNaN(a.value))).toBe(true);
    for (const s of ["xRp9", "PROMORP50", "abc5rp9", "IDR 7 dan rp.8", "Corp 5", "5IDR", "Rp 9"]) {
      const hits = [...normalizeForGuardrail(s).matchAll(/(?:rp|idr)\.?\s*\d|\d\s*(?:idr|rp)\b/gi)].length;
      expect(hits).toBeGreaterThan(0);
      expect(parseGuardrailAmounts(s).length).toBeGreaterThan(0);
    }
  });
});

describe("sentinel regexes", () => {
  it("marker trips anywhere on currency+digits, not on ordinary words", () => {
    for (const s of ["ProfitRp 9", "totalrp9", "iniIDR 9", "Totalrp. 9", "9.999.000 IDR", "Rp"]) {
      expect(CURRENCY_MARKER_RE.test(s)).toBe(true);
    }
    for (const s of ["terpakai", "terpenting", "Corp sudah", "jutawan"]) expect(CURRENCY_MARKER_RE.test(s)).toBe(false);
  });
  it("tail regex holds a dangling prefix", () => {
    for (const s of ["ProfitRp ", "totalrp", "Totalrp. ", "iniIDR"]) expect(CURRENCY_TAIL_RE.test(s)).toBe(true);
    for (const s of ["terpakai ", "Corp sudah "]) expect(CURRENCY_TAIL_RE.test(s)).toBe(false);
  });
});

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
const rep = [{ report: base, label: "minggu ini" }];

describe("applyProfitGuardrail with normalization", () => {
  it("catches glued, lowercase and spaced-suffix forms but returns the original text when correct", () => {
    for (const t of ["ProfitRp 9.999.000 ya.", "iniIDR 9.999.000.", "Totalrp. 9.999.000", "totalrp9.999.000", "9.999.000 IDR"]) {
      expect(applyProfitGuardrail(t, rep).replaced).toBe(true);
    }
    const ok = applyProfitGuardrail("ProfitRp 2.550.000 ya.", rep);
    expect(ok.replaced).toBe(false);
    expect(ok.text.startsWith("ProfitRp 2.550.000 ya.")).toBe(true);
  });

  it("dedupes identical templates from repeated successful results", () => {
    const r = applyProfitGuardrail("Profit Rp9.999.999", [...rep, ...rep]);
    expect(r.replaced).toBe(true);
    expect(r.text.match(/Profit minggu ini \(/g)).toHaveLength(1);
    expect(r.text.match(/Catatan:/g)).toHaveLength(1);
  });
});

// Ruling 29: unicode/markdown normalization and grouped-number candidates.
describe("Ruling 29 normalization", () => {
  it.each([
    ["Rp ９.９９９.０００", "Rp 9.999.000"],
    ["Ｒｐ 9.999.000", "Rp 9.999.000"],
    ["Rp​9.999.000﻿", "Rp9.999.000"],
    ["Rp −9.999.000", "Rp -9.999.000"],
    ["**Rp** 9.999.000", "Rp 9.999.000"],
    ["Rp~~9.999.000~~", "Rp9.999.000"],
    ["`Rp9.999.000`", "Rp9.999.000"],
    ["_Rp_ 9.999.000", "Rp 9.999.000"],
  ])("normalizes %j to %j", (a, b) => expect(normalizeForGuardrail(a)).toBe(b));

  it.each([
    "Profit Rp ９.９９９.０００.",
    "Profit Ｒｐ 9.999.000.",
    "Profit Rp​9.999.000.",
    "Profit **Rp** 9.999.000.",
    "Profit Rp~~9.999.000~~.",
    "Profit Rp −9.999.000.",
  ])("%j parses to an amount without profit context", (s) =>
    expect(parseGuardrailAmounts(s).map((a) => Math.abs(a.value))).toEqual([9999000]),
  );

  it("sentinel trip covers grouped numbers and normalized markers", () => {
    for (const s of ["maksimal 1.000 item", "12,500", "Ｒｐ", "R​p9", "９.９９９", "**Rp**"]) {
      expect(sentinelTrips(s)).toBe(true);
    }
    for (const s of ["312 transaksi", "naik 12%", "2026-10-20", "jam 10.30", "terpakai"]) expect(sentinelTrips(s)).toBe(false);
  });
});

describe("isProfitContext", () => {
  it("matches the profit vocabulary or a get_profit call", () => {
    for (const m of ["Profit minggu ini berapa?", "laba bulan lalu", "OMZET hari ini", "berapa HPP", "margin?", "penjualan kemarin"]) {
      expect(isProfitContext(m, false)).toBe(true);
    }
    expect(isProfitContext("Bagaimana cara refund?", false)).toBe(false);
    expect(isProfitContext("halo", true)).toBe(true);
    expect(isProfitContext("profitable", false)).toBe(false);
  });
});

describe("collectCandidateAmounts", () => {
  it("returns uncovered grouped numbers only in profit context", () => {
    const pc = { profitContext: true };
    expect(collectCandidateAmounts("Profit minggu ini 9.999.000.", pc).map((a) => a.value)).toEqual([9999000]);
    expect(collectCandidateAmounts("Profit minggu ini 9.999.000.", { profitContext: false })).toEqual([]);
    expect(collectCandidateAmounts("Profit Rp2.550.000 dari 312 transaksi", pc)).toEqual([]);
    expect(collectCandidateAmounts("| Rp | 9.999.000 |", pc).map((a) => a.value)).toEqual([9999000]);
    expect(collectCandidateAmounts("Profit 2.550.000,-", pc).map((a) => a.value)).toEqual([2550000]);
    expect(collectCandidateAmounts("rugi -250.000", pc).map((a) => a.value)).toEqual([-250000]);
    expect(collectCandidateAmounts("Profit 2.550.000,50", pc).map((a) => a.value)).toEqual([2550000.5]);
  });
  it("parseGuardrailAmounts includes candidates in profit context", () => {
    expect(parseGuardrailAmounts("Profit (Rp): 9.999.000", { profitContext: true }).map((a) => a.value)).toEqual([9999000]);
    expect(parseGuardrailAmounts("maksimal 1.000 item", { profitContext: false })).toEqual([]);
  });
  it("applyProfitGuardrail treats grouped candidates exactly (reports imply profit context)", () => {
    expect(applyProfitGuardrail("| Penjualan (Rp) | 4.250.000 |", rep).replaced).toBe(false);
    expect(applyProfitGuardrail("Profit (Rp): 9.999.000", rep).replaced).toBe(true);
    expect(applyProfitGuardrail("Profit 2.550.001", rep).replaced).toBe(true);
    expect(applyProfitGuardrail("dari 1.250 transaksi", [{ report: { ...base, transactions: 1250 }, label: "x" }]).replaced).toBe(true);
  });
});
