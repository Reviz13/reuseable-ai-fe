import { CURRENCY_TAIL_RE, normalizeForCheck, sentinelTrips } from "../money.js";

/**
 * Ruling 25: live text passes through this sentinel so that no rupiah amount reaches the client
 * unchecked.
 * - Text is released only up to the last whitespace boundary, so a split marker ("R" | "p2.550.000")
 *   is never half-emitted.
 * - A trailing word containing a digit is held too, because a suffix ("2.550.000 " | "juta") may
 *   follow.
 * - Once the pending text contains a currency marker or a grouped number (Ruling 29b), everything
 *   from there to the end of the turn is held for the guardrail. Markers are tested on the
 *   normalized checking copy (Ruling 29d: NFKC, zero-width, U+2212, markdown); emitted text is raw.
 */
export class StreamSentinel {
  private pending = "";
  private buffering = false;
  /** Text held for the end-of-turn guardrail. */
  held = "";

  constructor(private readonly emit: (text: string) => void) {}

  push(text: string): void {
    if (this.buffering) {
      this.held += text;
      return;
    }
    this.pending += text;
    if (sentinelTrips(this.pending)) {
      this.startBuffering();
      return;
    }
    let cut = lastWhitespaceEnd(this.pending);
    if (cut <= 0) return;
    const digitTail = /\S*\p{Nd}\S*\s+$/u.exec(this.pending.slice(0, cut));
    if (digitTail) cut = digitTail.index;
    // A dangling prefix ("ProfitRp ", "totalrp.") waits for what follows it (Ruling 28).
    const head = this.pending.slice(0, cut);
    if (CURRENCY_TAIL_RE.test(normalizeForCheck(head))) cut = /\S*\s*$/.exec(head)!.index;
    if (cut <= 0) return;
    this.emit(this.pending.slice(0, cut));
    this.pending = this.pending.slice(cut);
  }

  /** Round end: release what was held back for a boundary, provided no marker appeared. */
  flush(): void {
    if (this.buffering || !this.pending) return;
    this.emit(this.pending);
    this.pending = "";
  }

  /** Hold everything from now on (a marker appeared, or a tool was called). */
  startBuffering(): void {
    this.held += this.pending;
    this.pending = "";
    this.buffering = true;
  }
}

function lastWhitespaceEnd(s: string): number {
  for (let i = s.length - 1; i >= 0; i--) if (/\s/.test(s[i]!)) return i + 1;
  return 0;
}
