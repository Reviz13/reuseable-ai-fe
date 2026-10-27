import type { ProfitReport } from "@ai/contracts";
import { formatRupiah, parseGuardrailAmounts, type CandidateOptions, type ParsedAmount } from "../money.js";

export type LabeledReport = { report: ProfitReport; label: string };

const TOLERANCE = 0.005;

function matches(a: ParsedAmount, reports: LabeledReport[]): boolean {
  if (Number.isNaN(a.value)) return false;
  for (const { report: r } of reports) {
    for (const v of [r.sales, r.cogs, r.profit]) {
      const c = a.value;
      if (c === v || c === Math.round(v)) return true;
      if (a.scaled && Math.abs(c - v) <= Math.abs(v) * TOLERANCE) return true;
    }
  }
  return false;
}

function template({ report: r, label }: LabeledReport): string {
  return `Profit ${label} (${r.from} s.d. ${r.to}): ${formatRupiah(r.profit)}. Penjualan ${formatRupiah(r.sales)}, HPP ${formatRupiah(r.cogs)}, ${r.transactions} transaksi.`;
}

/**
 * Reports exist only when get_profit succeeded this turn, so the turn is profit-context (Ruling 29a)
 * and uncovered grouped numbers are candidate amounts by default.
 */
export function applyProfitGuardrail(
  text: string,
  reports: LabeledReport[],
  opts: CandidateOptions = { profitContext: true },
): { text: string; replaced: boolean } {
  if (reports.length === 0) return { text, replaced: false };
  let out = text;
  // Rulings 28/29: parse a normalized copy with a fail-closed backstop and grouped-number
  // candidates; passing text is returned as written.
  const replaced = parseGuardrailAmounts(text, opts).some((a) => !matches(a, reports));
  if (replaced) out = [...new Set(reports.map(template))].join("\n");
  for (const { report } of reports) {
    if (report.missing_cost_items > 0) {
      const note = `Catatan: profit belum memperhitungkan ${report.missing_cost_items} item tanpa HPP.`;
      if (!out.includes(note)) out = `${out}\n${note}`;
    }
  }
  return { text: out, replaced };
}
