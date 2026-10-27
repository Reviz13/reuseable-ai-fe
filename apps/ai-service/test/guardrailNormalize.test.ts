import { describe, expect, it } from "vitest";
import type { ProfitReport } from "@ai/contracts";
import {
  CURRENCY_MARKER_RE,
  CURRENCY_TAIL_RE,
  collectCandidateAmounts,
  isProfitContext,
  sentinelTrips,
  normalizeForCheck,
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
    // M6: a 4-digit run ("2026-10-20") now stops live streaming too; the guardrail exempts years.
    expect(sentinelTrips("2026-10-20")).toBe(true);
    for (const s of ["312 transaksi", "naik 12%", "jam 10.30", "terpakai"]) expect(sentinelTrips(s)).toBe(false);
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

describe("final fix wave: render-time transforms (M1)", () => {
  const bs = "\\";
  it.each([
    [`9${bs}.999${bs}.000`, "9.999.000"],
    ["9&#46;999&#46;000", "9.999.000"],
    ["Rp&#57;.999.000", "Rp9.999.000"],
    ["Rp&#x39;.999.000", "Rp9.999.000"],
    ["9&period;999&comma;000&amp;&nbsp;&dollar;", "9.999,000& $"],
    ["9<span></span>.999.000", "9.999.000"],
    ["R<b>p</b>9.999.000", "Rp9.999.000"],
  ])("checking copy of %j is %j", (a, b) => expect(normalizeForCheck(a)).toBe(b));

  it.each([
    `Profit minggu ini 9${bs}.999${bs}.000 ya.`,
    "Profit minggu ini 9&#46;999&#46;000",
    "Profit Rp&#57;.999.000.",
    "Profit 9<span></span>.999.000.",
  ])("applyProfitGuardrail replaces %j", (s) => {
    const g = applyProfitGuardrail(s, rep);
    expect(g.replaced).toBe(true);
    expect(g.text).not.toMatch(/9\.999\.000/);
  });

  it("an unknown named entity trips the sentinel and fails closed in profit context", () => {
    expect(sentinelTrips("Profit 9&foo;")).toBe(true);
    expect(sentinelTrips("Langkah &hellip; selesai")).toBe(true);
    expect(parseGuardrailAmounts("Profit &hellip; selesai", { profitContext: true }).some((a) => Number.isNaN(a.value))).toBe(true);
    expect(parseGuardrailAmounts("Langkah &hellip; selesai", { profitContext: false })).toEqual([]);
  });
});

describe("final fix wave: number tokens after punctuation (M4, Ruling 33)", () => {
  it.each(["Profit minggu ini,9.999.000.", "Profit...9.999.000", "Profit.9.999.000"])("%j is replaced", (s) => {
    expect(collectCandidateAmounts(s, { profitContext: true }).map((a) => a.value)).toEqual([9999000]);
    expect(applyProfitGuardrail(s, rep).replaced).toBe(true);
  });
});

describe("final fix wave: profit vocabulary (M5, Rulings 34/49)", () => {
  it.each([
    "Untungnya berapa minggu ini?",
    "Berapa keuntungannya?",
    "Labanya gimana?",
    "kerugian",
    "cuan minggu ini",
    "profitnya",
    "penjualannya",
    "omzetnya",
    "pemasukan hari ini",
    "jualan kemarin",
    "Sales this week",
    "REVENUE",
    "income?",
  ])("%j is profit-context", (m) => expect(isProfitContext(m, false)).toBe(true));
  it.each(["Bagaimana cara refund?", "profitable", "salesman"])("%j is not", (m) => expect(isProfitContext(m, false)).toBe(false));
  it("'Untungnya 9.999.000.' is replaced", () => expect(applyProfitGuardrail("Untungnya 9.999.000.", rep).replaced).toBe(true));
});

describe("final fix wave: ungrouped and space-grouped figures (M6, Ruling 35)", () => {
  const pc = { profitContext: true };
  it.each(["9999000", "9 999 000", "9 999 000", "9 999 000", "9'999'000", "Rp: 2026"])("sentinel trips on %j", (s) =>
    expect(sentinelTrips(s)).toBe(true),
  );
  it.each([
    ["Profit minggu ini 9999000 ya.", 9999000],
    ["Profit minggu ini 9 999 000 ya.", 9999000],
    ["Profit minggu ini 9'999'000 ya.", 9999000],
    ["Profit 12500", 12500],
  ])("%j is a candidate", (s, v) => expect(collectCandidateAmounts(s, pc).map((a) => a.value)).toContain(v));
  it("years 1900-2100 are exempt unless next to a currency marker", () => {
    expect(collectCandidateAmounts("Profit 2026 ini", pc)).toEqual([]);
    expect(collectCandidateAmounts("Profit 1899 ini", pc).map((a) => a.value)).toEqual([1899]);
    expect(collectCandidateAmounts("Profit Rp: 2026", pc).map((a) => a.value)).toEqual([2026]);
    expect(collectCandidateAmounts("Profit 2026 , rupiah", pc).map((a) => a.value)).toEqual([2026]);
  });
  it("'Profit 2026 ini Rp2.550.000' passes with a successful report", () =>
    expect(applyProfitGuardrail("Profit 2026 ini Rp2.550.000", rep).replaced).toBe(false));
  it("ISO dates in a correct profit answer are not replaced", () =>
    expect(applyProfitGuardrail("Profit minggu ini (2026-10-20 s.d. 2026-10-26): Rp2.550.000.", rep).replaced).toBe(false));
  it("a space-grouped correct figure passes", () => expect(applyProfitGuardrail("Profit 2 550 000", rep).replaced).toBe(false));
  it("no candidates outside profit context", () => expect(collectCandidateAmounts("9999000", { profitContext: false })).toEqual([]));
});

describe("final fix wave: kerugian negation (S5)", () => {
  const loss = (profit: number) => [{ report: { ...base, profit }, label: "x" }];
  it("'kerugian Rp250.000' with profit +250000 is replaced", () =>
    expect(applyProfitGuardrail("kerugian Rp250.000", loss(250000)).replaced).toBe(true));
  it("'kerugian Rp250.000' with profit -250000 passes", () =>
    expect(applyProfitGuardrail("kerugian Rp250.000", loss(-250000)).replaced).toBe(false));
  it("'ruginya minggu ini Rp250.000' with profit -250000 passes", () =>
    expect(applyProfitGuardrail("ruginya minggu ini Rp250.000", loss(-250000)).replaced).toBe(false));
});

describe("N1/N2: both checking copies and markdown link text", () => {
  it("normalizeForCheck keeps tags on request; links become their text", () => {
    expect(normalizeForCheck("<x 9.999.000>", { keepTags: true })).toBe("<x 9.999.000>");
    expect(normalizeForCheck("<x 9.999.000>")).toBe("");
    expect(normalizeForCheck("[9](x).[999](y).[000](z)")).toBe("9.999.000");
    expect(normalizeForCheck("[9][a].[999][b].[000]")).toBe("9.999.000");
  });
  it.each(["<9.999.000>", "<Rp9.999.000>", '<b title="Rp9.999.000">x</b>', "<https://x/9.999.000>"])(
    "sentinel trips on %j",
    (s) => expect(sentinelTrips(s)).toBe(true),
  );
  it.each([
    "Profit minggu ini <9.999.000> ya.",
    "Profit minggu ini <Rp:9.999.000> ya.",
    "Profit < Rp9.999.000 > lalu.",
    "Profit minggu ini <Rp9.999.000 dan >0.",
    "Profit [9](x).[999](y).[000](z)",
  ])("applyProfitGuardrail replaces %j", (s) => expect(applyProfitGuardrail(s, rep).replaced).toBe(true));
  it.each(["<b>Rp2.550.000</b>", "[Rp2.550.000](x)"])("correct %j passes", (s) =>
    expect(applyProfitGuardrail(s, rep).replaced).toBe(false),
  );
});
