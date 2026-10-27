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
    // S5: "kerugian", "ruginya", "kerugiannya" negate like "rugi".
    String.raw`(?<neg>-\s*|\b(?:ke)?rugi(?:an)?(?:nya)?(?:\s+[a-z]+){0,2}?\s+)?`,
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

// Cyrillic/Greek letters that look like the Latin letters of "Rp" (NFKC leaves them alone).
const CONFUSABLES: Record<string, string> = { "Р": "P", "р": "p", "Ρ": "P", "ρ": "p" };

// Named entities decoded for checking. Any other named entity is left in place and fails closed.
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  nbsp: " ",
  period: ".",
  comma: ",",
  dollar: "$",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};
/** A named entity the checking copy could not decode (M1: counts as a marker / NaN candidate). */
const UNKNOWN_ENTITY_RE = /&[a-z][a-z0-9]*;/i;

function decodeEntity(whole: string, body: string): string {
  if (body[0] === "#") {
    const cp = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
  }
  return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
}

/**
 * Ruling 29(d): the checking copy of model text. Never displayed.
 * - M1 render-time transforms first: HTML tags removed, character references decoded in one pass
 *   (numeric with or without ";", the common named ones), markdown backslash escapes undone, so
 *   `9\.999\.000`, `9&#46;999&#46;000` and `9<span></span>.999.000` read as 9.999.000.
 * - NFKC (full-width digits/letters, NBSP), combining marks and zero-width characters removed,
 *   U+2212 as "-", look-alike Cyrillic/Greek letters mapped, markdown emphasis/code characters removed.
 */
export function normalizeForCheck(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (whole, body: string) =>
      body[0] !== "#" && !whole.endsWith(";") ? whole : decodeEntity(whole, body),
    )
    .replace(/\\([!-/:-@[-`{-~])/g, "$1")
    .normalize("NFKC")
    .replace(/\p{M}/gu, "")
    .replace(/[​-‍﻿]/g, "")
    .replace(/−/g, "-")
    .replace(/[РрΡρ]/g, (c) => CONFUSABLES[c]!)
    .replace(/[*_~`]/g, "");
}

/**
 * Ruling 28/29: guardrail input is parsed from a normalized copy, so spacing, case, unicode
 * look-alikes and markdown cannot hide an amount. After normalizeForCheck, a space is inserted
 * between a letter and a following Rp/IDR when digits follow.
 */
export function normalizeForGuardrail(text: string): string {
  return normalizeForCheck(text).replace(GLUED_PREFIX_RE, "$1 ");
}

/** Ruling 29(b): a grouped number ("1.000", "9.999.000", "12,500"). */
const GROUPED_RE = /\d{1,3}(?:[.,]\d{3})+/;
/** Ruling 35 / M6: a run of 4+ digits ("9999000", "2026"). */
const LONG_RUN_RE = /\d{4,}/;
/**
 * Ruling 35 / M6: space-, NBSP-, narrow-NBSP- or apostrophe-grouped figures ("9 999 000",
 * "9'999'000"). Tested on the checking copy, where NFKC has already turned NBSP/U+202F into spaces.
 */
const SPACED_RE = /\d{1,3}(?:['’\s  ]\d{3})+/;
const SPACED_TOKEN_RE = /(?<![\d.,'’])\d{1,3}(?:['’\s  ]\d{3})+(?!\d)/g;

/**
 * Ruling 29(b, d) + M1/M6: the sentinel stops live streaming on a currency marker, a grouped,
 * space-grouped or 4+-digit number, or a named character reference the checking copy cannot decode.
 */
export function sentinelTrips(text: string): boolean {
  const n = normalizeForCheck(text);
  return CURRENCY_MARKER_RE.test(n) || GROUPED_RE.test(n) || LONG_RUN_RE.test(n) || SPACED_RE.test(n) || UNKNOWN_ENTITY_RE.test(n);
}

/**
 * Rulings 29(a)/31/34/49: the one profit vocabulary, used for the current user message, the
 * previous user message in history, and the held answer text. Affixed forms count: keuntungan,
 * kerugian, untungnya, labanya, penjualannya; plus slang and English.
 */
export const PROFIT_WORD_RE =
  /\b(?:ke)?(?:profit|laba|untung|rugi|omzet|omset|penjualan|pendapatan|hpp|margin|cuan|pemasukan|jualan)(?:an)?(?:nya)?\b|\b(?:sales|revenue|income)\b/i;

/** A profit word in `text`, checked on the normalized checking copy. */
export function mentionsProfit(text: string | undefined): boolean {
  return !!text && PROFIT_WORD_RE.test(normalizeForCheck(text));
}

export function isProfitContext(message: string, getProfitCalled: boolean): boolean {
  return getProfitCalled || mentionsProfit(message);
}

/**
 * A whole currency word (Rp, IDR, rupiah) in the checking copy. The orchestrator also treats held
 * text that names the currency as profit-context, so "| Rp | 9.999.000 |" is checked even when the
 * user's question had no profit vocabulary (extension of Ruling 29, same cost as Ruling 25 prices).
 */
export function mentionsCurrency(text: string): boolean {
  return /(?<![a-z])(?:rp|idr|rupiah)(?![a-z])/i.test(normalizeForCheck(text));
}

export type CandidateOptions = { profitContext: boolean };

// A whole number token; it is a candidate when it contains a grouped number or a 4+-digit run.
// Ruling 33 / M4: a token may start right after "," or "." when no digit precedes them
// ("ini,9.999.000", "Profit.9.999.000"), but never inside a grouped number.
const NUMBER_TOKEN_RE = /(?<!\d)(?<!\d[.,])\d+(?:[.,]\d+)*/g;
const FAILED: ParsedAmount = { value: NaN, scaled: false, viaRugi: false };
const CURRENCY_BEFORE_RE = /(?:rp|idr|rupiah)[^a-z0-9]{0,3}$/i;
const CURRENCY_AFTER_RE = new RegExp(String.raw`^[^a-z0-9]{0,3}(?:${PREFIX}|${SUFFIX})(?![a-z])`, "i");

/**
 * Ruling 35 / M6 exception: a standalone 4-digit number from 1900 to 2100 ("2026") that is not
 * within 3 characters of a currency marker and not part of a space/apostrophe group is a year.
 */
function isYear(normalized: string, token: string, start: number, end: number): boolean {
  if (!/^\d{4}$/.test(token)) return false;
  const y = Number(token);
  if (y < 1900 || y > 2100) return false;
  const before = normalized.slice(Math.max(0, start - 12), start);
  const after = normalized.slice(end, end + 12);
  if (/\d['’\s]$/.test(before) || /^['’\s]\d/.test(after)) return false;
  return !CURRENCY_BEFORE_RE.test(before) && !CURRENCY_AFTER_RE.test(after);
}

function candidatesIn(normalized: string, covered: Located[]): ParsedAmount[] {
  const out: ParsedAmount[] = [];
  const isCovered = (start: number, end: number) => covered.some((l) => l.start < end && start < l.end);
  const push = (base: number | null, start: number) => {
    if (base === null) return void out.push(FAILED);
    const neg = normalized[start - 1] === "-";
    out.push({ value: neg && base !== 0 ? -base : base, scaled: false, viaRugi: false });
  };
  for (const m of normalized.matchAll(NUMBER_TOKEN_RE)) {
    if (!GROUPED_RE.test(m[0]) && !LONG_RUN_RE.test(m[0])) continue;
    const start = m.index!;
    const end = start + m[0].length;
    if (isCovered(start, end) || isYear(normalized, m[0], start, end)) continue;
    push(parseNumber(m[0]), start);
  }
  for (const m of normalized.matchAll(SPACED_TOKEN_RE)) {
    const start = m.index!;
    if (isCovered(start, start + m[0].length)) continue;
    push(Number(m[0].replace(/\D/g, "")), start);
  }
  // M1 fail-closed: a character reference the checking copy could not decode may hide a figure.
  if (UNKNOWN_ENTITY_RE.test(normalized)) out.push(FAILED);
  return out;
}

/**
 * Ruling 29(c): in a profit-context turn, every grouped number the parser does not already account
 * for is a candidate amount. The guardrail then requires it to equal a successful report's
 * sales/cogs/profit exactly (candidates are never "scaled", so no tolerance applies).
 */
export function collectCandidateAmounts(text: string, opts: CandidateOptions): ParsedAmount[] {
  if (!opts.profitContext) return [];
  const normalized = normalizeForGuardrail(text);
  return candidatesIn(normalized, scan(normalized));
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
    const viaRugi = !!g.neg && /^(?:ke)?rugi/i.test(g.neg);
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
export function parseGuardrailAmounts(text: string, opts: CandidateOptions = { profitContext: false }): ParsedAmount[] {
  const normalized = normalizeForGuardrail(text);
  const located = scan(normalized);
  const out = located.map((l) => l.amount);
  for (const m of normalized.matchAll(BACKSTOP_RE)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (!located.some((l) => l.start < end && start < l.end)) out.push(FAILED);
  }
  if (opts.profitContext) out.push(...candidatesIn(normalized, located));
  return out;
}

export function parseRupiahAmounts(text: string): number[] {
  return parseRupiahAmountsDetailed(text).map((a) => a.value);
}
