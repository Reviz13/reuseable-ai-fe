import { describe, expect, it } from "vitest";
import type { ProfitReport } from "@ai/contracts";
import {
  CURRENCY_MARKER_RE,
  CURRENCY_TAIL_RE,
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
