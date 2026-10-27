export interface Chunk {
  ord: number;
  heading?: string;
  content: string;
  token_count: number;
}

export interface ChunkOpts {
  maxTokens: number;
  overlap: number;
}

const tokens = (s: string): number => Math.ceil(s.length / 4);
const splitSentences = (s: string): string[] => s.split(/(?<=[.!?])\s+/).filter((x) => x.length > 0);

/** Returns the heading text if the line is a heading, else null. */
function headingOf(line: string): string | null {
  const t = line.trim();
  if (!t) return null;
  const md = /^#{1,6}\s+(.+?)\s*#*$/.exec(t);
  if (md) return md[1]!.trim();
  if (t.length > 80) return null;
  const letters = t.match(/\p{L}/gu) ?? [];
  if (letters.length >= 3 && t === t.toUpperCase() && t !== t.toLowerCase() && !t.endsWith(".")) return t;
  if (/^\d+(\.\d+)*[.)]?\s+\p{Lu}/u.test(t) && !t.endsWith(".")) return t;
  return null;
}

/** Splits text into pieces of at most maxChars, on sentence boundaries, then hard splits. */
function splitOversized(text: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let cur = "";
  const flush = () => {
    if (cur) pieces.push(cur);
    cur = "";
  };
  for (const sentence of splitSentences(text)) {
    if (sentence.length > maxChars) {
      flush();
      for (let i = 0; i < sentence.length; i += maxChars) pieces.push(sentence.slice(i, i + maxChars));
      continue;
    }
    if (cur && cur.length + 1 + sentence.length > maxChars) flush();
    cur = cur ? `${cur} ${sentence}` : sentence;
  }
  flush();
  return pieces;
}

/** Trailing sentences of `text` totalling at least `overlap` tokens (or all of it). */
function overlapTail(text: string, overlap: number): string[] {
  const sentences = splitSentences(text);
  const tail: string[] = [];
  let size = 0;
  for (let i = sentences.length - 1; i >= 0 && size < overlap; i--) {
    tail.unshift(sentences[i]!);
    size = tokens(tail.join(" "));
  }
  return tail;
}

export function chunkText(
  text: string,
  opts: ChunkOpts = { maxTokens: 500, overlap: 80 },
): Chunk[] {
  const { maxTokens, overlap } = opts;
  const maxChars = maxTokens * 4;

  // 1. sections by heading
  const sections: Array<{ heading?: string; lines: string[] }> = [{ lines: [] }];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const h = headingOf(line);
    if (h !== null) sections.push({ heading: h, lines: [] });
    else sections[sections.length - 1]!.lines.push(line);
  }

  const out: Chunk[] = [];
  const emit = (heading: string | undefined, content: string) => {
    const chunk: Chunk = { ord: out.length, content, token_count: tokens(content) };
    if (heading !== undefined) chunk.heading = heading;
    out.push(chunk);
  };

  for (const section of sections) {
    // 2. paragraphs; oversized ones are split, leaving room for the overlap tail
    const units: string[] = [];
    for (const p of section.lines.join("\n").split(/\n\s*\n/)) {
      const para = p.trim();
      if (!para) continue;
      if (tokens(para) > maxTokens) {
        const room = Math.max(maxChars - overlap * 4, Math.floor(maxChars / 2));
        units.push(...splitOversized(para, room));
      } else units.push(para);
    }
    if (units.length === 0) continue;

    // 3. pack up to maxTokens; each new chunk starts with an overlap tail from the same section
    let cur = "";
    for (const unit of units) {
      if (cur && tokens(`${cur}\n\n${unit}`) <= maxTokens) {
        cur = `${cur}\n\n${unit}`;
        continue;
      }
      if (cur) {
        emit(section.heading, cur);
        const tail = overlapTail(cur, overlap);
        while (tail.length > 0 && tokens(`${tail.join(" ")}\n\n${unit}`) > maxTokens) tail.shift();
        cur = tail.length > 0 ? `${tail.join(" ")}\n\n${unit}` : unit;
      } else {
        cur = unit;
      }
    }
    if (cur) emit(section.heading, cur);
  }
  return out;
}
