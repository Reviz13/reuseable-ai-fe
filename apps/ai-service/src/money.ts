/** Rupiah formatting and parsing. Independent of host ICU locale data. */

export function formatRupiah(n: number): string {
  const r = Math.round(Math.abs(n));
  const grouped = String(r).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${n < 0 && r !== 0 ? "-" : ""}Rp${grouped}`;
}

export type ParsedAmount = {
  value: number;
  /** Written with jt/juta/miliar: eligible for the guardrail's ±0.5% tolerance. */
  scaled: boolean;
  /** Written as `rugi X`: the sign was supplied by the word. */
  viaRugi: boolean;
};

const SCALE: Record<string, number> = {
  rb: 1e3,
  ribu: 1e3,
  jt: 1e6,
  juta: 1e6,
  miliar: 1e9,
  jutaan: 1e6,
  rupiah: 1,
};

const CURRENCY_PREFIXES = ["rp", "idr"];

/**
 * Any currency word the amount parser understands (prefixes plus SCALE suffixes), as a whole word.
 * Used by the chat stream sentinel to stop live streaming before an amount can be emitted.
 */
export const CURRENCY_MARKER_RE = new RegExp(
  `(?<![a-z])(?:${[...CURRENCY_PREFIXES, ...Object.keys(SCALE)].sort((a, b) => b.length - a.length).join("|")})(?![a-z])`,
  "i",
);

// [sign: "-" | "rugi [filler words]"] [Rp|IDR [-]] number [suffix]
const AMOUNT_RE =
  /(?<neg>-\s*|\brugi(?:\s+[a-z]+){0,2}?\s+)?(?:(?<![a-z])(?<cur>rp|idr)\.?\s*(?<neg2>-\s*)?)?(?<num>\d+(?:[.,]\d+)*)(?:\s*(?<suf>miliar|jutaan|juta|jt|ribu|rb|rupiah)(?![a-z]))?/gi;

function parseNumber(raw: string): number | null {
  const commas = raw.split(",").length - 1;
  let s = raw;
  if (commas >= 2 || /,\d{3}\./.test(raw)) {
    // en-US grouping: commas group thousands, dot is the decimal separator.
    if (!/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw)) return null;
    s = raw.replace(/,/g, "");
  } else if (commas === 1) {
    // id-ID: dots group thousands, comma is the decimal separator.
    const [int, frac] = raw.split(",") as [string, string];
    if (int.includes(".") && !/^\d{1,3}(\.\d{3})+$/.test(int)) return null;
    s = `${int.replace(/\./g, "")}.${frac}`;
  } else if (s.includes(".")) {
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
    else if (s.split(".").length !== 2) return null; // single dot with != 3 decimals: decimal point
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseRupiahAmountsDetailed(text: string): ParsedAmount[] {
  const out: ParsedAmount[] = [];
  for (const m of text.matchAll(AMOUNT_RE)) {
    const g = m.groups!;
    const suf = g.suf?.toLowerCase();
    if (!g.cur && !suf) continue; // bare numbers are not amounts
    const base = parseNumber(g.num!);
    if (base === null) {
      // Fail closed: a currency-tagged amount we cannot read must not pass the guardrail.
      out.push({ value: NaN, scaled: false, viaRugi: false });
      continue;
    }
    let value = Math.round(base * (suf ? SCALE[suf]! : 1) * 100) / 100;
    const viaRugi = !!g.neg && /^rugi/i.test(g.neg);
    if ((g.neg && !viaRugi) || g.neg2 || viaRugi) value = -value;
    out.push({ value: value === 0 ? 0 : value, scaled: !!suf && SCALE[suf]! >= 1e6, viaRugi });
  }
  return out;
}

export function parseRupiahAmounts(text: string): number[] {
  return parseRupiahAmountsDetailed(text).map((a) => a.value);
}
