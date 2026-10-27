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
 * Sentinel trigger (Ruling 28): a currency prefix followed by digits ANYWHERE (no letter
 * lookbehind: "ProfitRp 9", "totalrp9"), or any whole currency/scale word ("Rp", "juta", "IDR").
 * Deliberately looser than the parser: tripping only buffers text, it never replaces it.
 */
export const CURRENCY_MARKER_RE = new RegExp(
  String.raw`(?:${PREFIX})\.?\s*\d|(?<![a-z])(?:${byLength([...CURRENCY_PREFIXES, ...Object.keys(SCALE)])})(?![a-z])`,
  "i",
);

/** A dangling currency prefix at the end of streamed text ("ProfitRp ", "totalrp."): hold it. */
export const CURRENCY_TAIL_RE = new RegExp(String.raw`(?:${PREFIX})\.?\s*$`, "i");

// [sign: "-" | "rugi [filler words]"] [Rp|IDR [-] | glued Rp|IDR] number [Rp|IDR | suffix]
const AMOUNT_RE = new RegExp(
  [
    String.raw`(?<neg>-\s*|\brugi(?:\s+[a-z]+){0,2}?\s+)?`,
    // A prefix glued to a preceding word ("totalRp2.550.000") must touch the digits and is
    // checked for capitalisation below, so "Corp 5" / "corp5" stay non-amounts in raw text.
    String.raw`(?:(?:(?<![a-z])(?<cur>${PREFIX})\.?\s*|(?<glued>${PREFIX})(?=\d))(?<neg2>-\s*)?)?`,
    String.raw`(?<num>\d+(?:[.,]\d+)*)`,
    // Rp/IDR after the number, glued or spaced ("2550000IDR", "9.999.000 IDR"), unless it is the
    // prefix of a following amount ("5 Rp10.000").
    String.raw`(?:\s*(?<post>${PREFIX})(?![a-z])(?!\.?\s*\d)|\s*(?<suf>${SUFFIX})(?![a-z]))?`,
  ].join(""),
  "gi",
);

// Letter directly before a currency prefix that is followed by digits ("ProfitRp 9", "totalrp9").
const GLUED_PREFIX_RE = new RegExp(String.raw`([a-z])(?=(?:${PREFIX})\.?\s*\d)`, "gi");
// Every currency-tagged digit position the backstop requires an amount for.
const BACKSTOP_RE = new RegExp(String.raw`(?:${PREFIX})\.?\s*\d|\d\s*(?:${PREFIX})\b`, "gi");

/**
 * Ruling 28: guardrail input is parsed from a normalized copy, so spacing and case cannot hide an
 * amount. A space is inserted between a letter and a following Rp/IDR when digits follow.
 */
export function normalizeForGuardrail(text: string): string {
  return text.replace(GLUED_PREFIX_RE, "$1 ");
}

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

type Located = { amount: ParsedAmount; start: number; end: number };

function scan(text: string): Located[] {
  const out: Located[] = [];
  for (const m of text.matchAll(AMOUNT_RE)) {
    const g = m.groups!;
    const suf = g.suf?.toLowerCase();
    if (g.glued && !/^(?:Rp|RP|IDR)$/.test(g.glued)) continue; // "corp5": a word, not a currency
    if (!g.cur && !g.glued && !g.post && !suf) continue; // bare numbers are not amounts
    const at = { start: m.index!, end: m.index! + m[0].length };
    const base = parseNumber(g.num!);
    if (base === null) {
      // Fail closed: a currency-tagged amount we cannot read must not pass the guardrail.
      out.push({ amount: { value: NaN, scaled: false, viaRugi: false }, ...at });
      continue;
    }
    let value = Math.round(base * (suf ? SCALE[suf]! : 1) * 100) / 100;
    const viaRugi = !!g.neg && /^rugi/i.test(g.neg);
    if ((g.neg && !viaRugi) || g.neg2 || viaRugi) value = -value;
    out.push({ amount: { value: value === 0 ? 0 : value, scaled: !!suf && SCALE[suf]! >= 1e6, viaRugi }, ...at });
  }
  return out;
}

export function parseRupiahAmountsDetailed(text: string): ParsedAmount[] {
  return scan(text).map((l) => l.amount);
}

/**
 * Amounts for the guardrail (Ruling 28): parses the normalized text, then adds NaN for every
 * currency+digit position (`Rp 9`, `9 IDR`, any case) that no parsed amount covers, so an
 * unrecognised form forces replacement instead of passing.
 */
export function parseGuardrailAmounts(text: string): ParsedAmount[] {
  const normalized = normalizeForGuardrail(text);
  const located = scan(normalized);
  const out = located.map((l) => l.amount);
  for (const m of normalized.matchAll(BACKSTOP_RE)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (!located.some((l) => l.start < end && start < l.end)) out.push({ value: NaN, scaled: false, viaRugi: false });
  }
  return out;
}

export function parseRupiahAmounts(text: string): number[] {
  return parseRupiahAmountsDetailed(text).map((a) => a.value);
}
