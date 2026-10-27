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
  jutaan: 1e6,
  miliar: 1e9,
  milyar: 1e9,
  triliun: 1e12,
  rupiah: 1,
};

const CURRENCY_PREFIXES = ["rp", "idr"];
const byLength = (words: string[]) => [...words].sort((a, b) => b.length - a.length).join("|");
const PREFIX = byLength(CURRENCY_PREFIXES);
const SUFFIX = byLength(Object.keys(SCALE));

/**
 * Any currency word the amount parser understands (prefixes plus SCALE suffixes) as a whole word,
 * or a prefix glued to digits ("totalRp2.550.000"). Used by the chat stream sentinel to stop live
 * streaming before an amount can be emitted. Deliberately looser than the parser ("corp5" trips it):
 * tripping only buffers text, it never replaces it.
 */
export const CURRENCY_MARKER_RE = new RegExp(
  String.raw`(?<![a-z])(?:${byLength([...CURRENCY_PREFIXES, ...Object.keys(SCALE)])})(?![a-z])|(?:${PREFIX})(?=\d)`,
  "i",
);

// [sign: "-" | "rugi [filler words]"] [Rp|IDR [-] | glued Rp|IDR] number [glued Rp|IDR | suffix]
const AMOUNT_RE = new RegExp(
  [
    String.raw`(?<neg>-\s*|\brugi(?:\s+[a-z]+){0,2}?\s+)?`,
    // A prefix glued to a preceding word ("totalRp2.550.000") must touch the digits and is
    // checked for capitalisation below, so "Corp 5" / "corp5" stay non-amounts.
    String.raw`(?:(?:(?<![a-z])(?<cur>${PREFIX})\.?\s*|(?<glued>${PREFIX})(?=\d))(?<neg2>-\s*)?)?`,
    String.raw`(?<num>\d+(?:[.,]\d+)*)`,
    String.raw`(?:(?<post>${PREFIX})(?![a-z])|\s*(?<suf>${SUFFIX})(?![a-z]))?`,
  ].join(""),
  "gi",
);

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
    if (g.glued && !/^(?:Rp|RP|IDR)$/.test(g.glued)) continue; // "corp5": a word, not a currency
    if (!g.cur && !g.glued && !g.post && !suf) continue; // bare numbers are not amounts
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
