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
};

// [sign: "-" | "rugi [filler words]"] [Rp|IDR [-]] number [suffix]
const AMOUNT_RE =
  /(?<neg>-\s*|\brugi(?:\s+[a-z]+){0,2}?\s+)?(?:(?<![a-z])(?<cur>rp|idr)\.?\s*(?<neg2>-\s*)?)?(?<num>\d+(?:[.,]\d+)*)(?:\s*(?<suf>miliar|juta|jt|ribu|rb)(?![a-z]))?/gi;

function parseNumber(raw: string): number | null {
  let s = raw;
  if (s.includes(",")) {
    // id-ID: dots group thousands, comma is the decimal separator.
    const parts = s.split(",");
    if (parts.length !== 2) return null;
    const int = parts[0]!;
    if (int.includes(".") && !/^\d{1,3}(\.\d{3})+$/.test(int)) return null;
    s = `${int.replace(/\./g, "")}.${parts[1]}`;
  } else if (s.includes(".")) {
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
    else if (s.split(".").length !== 2) return null; // else a single dot with != 3 decimals: decimal point
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
    if (base === null) continue;
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
