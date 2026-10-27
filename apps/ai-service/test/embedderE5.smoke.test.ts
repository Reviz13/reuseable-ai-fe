import { describe, expect, it } from "vitest";
import { createLocalEmbedder, EMBEDDING_DIMS } from "../src/rag/embedder.js";

// S6: opt-in smoke test of the real multilingual-e5-small model (downloads ~120 MB on first run).
// Run with E5_SMOKE=1; skipped otherwise.
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);

describe.skipIf(process.env.E5_SMOKE !== "1")("real e5 embedder (E5_SMOKE=1)", () => {
  it("returns 384-dim vectors and ranks the matching passage first", async () => {
    const e = createLocalEmbedder();
    const docs = [
      "Cara melakukan refund: buka menu Transaksi, pilih struk, tekan tombol Refund.",
      "Printer struk tidak mencetak: periksa kertas dan sambungan Bluetooth printer.",
      "Tutup shift: hitung kas di laci lalu tekan Tutup Shift di menu Kasir.",
    ];
    const [q] = await e.embed(["Bagaimana cara refund transaksi?"], "query");
    const passages = await e.embed(docs, "passage");
    expect(q!.length).toBe(EMBEDDING_DIMS);
    for (const p of passages) expect(p.length).toBe(EMBEDDING_DIMS);
    const scores = passages.map((p) => dot(q!, p));
    expect(scores.indexOf(Math.max(...scores))).toBe(0);
  }, 300_000);
});
