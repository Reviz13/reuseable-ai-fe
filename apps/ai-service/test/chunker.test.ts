import { describe, expect, it } from "vitest";
import { chunkText } from "../src/rag/chunker.js";
import { createHashEmbedder, createLocalEmbedder } from "../src/rag/embedder.js";

function para(topic: string, n: number): string {
  return Array.from({ length: n }, (_, i) => `Langkah ${i + 1} untuk ${topic} harus dilakukan dengan teliti oleh kasir.`).join(" ");
}
function section(title: string, topic: string): string {
  // ~600 tokens per section, in 3 paragraphs
  return `## ${title}\n\n${para(topic, 11)}\n\n${para(topic + " lanjutan", 11)}\n\n${para(topic + " akhir", 11)}`;
}
const DOC = [section("Membuka Kasir", "buka kasir"), section("Transaksi Penjualan", "penjualan"), section("Laporan Harian", "laporan")].join("\n\n");

describe("chunkText", () => {
  it("returns [] for empty / whitespace", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("  \n\n ")).toEqual([]);
  });

  it("respects the 500 token ceiling and keeps headings", () => {
    const chunks = chunkText(DOC);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) {
      expect(c.token_count).toBeLessThanOrEqual(500);
      expect(c.token_count).toBe(Math.ceil(c.content.length / 4));
    }
    expect(chunks.map((c) => c.ord)).toEqual(chunks.map((_, i) => i));
    const headings = new Set(chunks.map((c) => c.heading));
    expect(headings).toEqual(new Set(["Membuka Kasir", "Transaksi Penjualan", "Laporan Harian"]));
  });

  it("overlaps consecutive chunks within a section by at least one sentence, not across sections", () => {
    const chunks = chunkText(DOC);
    let overlaps = 0;
    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1]!;
      const cur = chunks[i]!;
      if (prev.heading === cur.heading) {
        const firstSentence = cur.content.split(/(?<=[.!?])\s+/)[0]!;
        expect(prev.content).toContain(firstSentence);
        overlaps++;
      } else {
        expect(prev.content.includes(cur.content.split(/(?<=[.!?])\s+/)[0]!)).toBe(false);
      }
    }
    expect(overlaps).toBeGreaterThan(0);
  });

  it("detects ALL-CAPS and numbered headings", () => {
    const chunks = chunkText("PENGANTAR\nIni pengantar.\n\n1.2 Cara Bayar\nBayar tunai.\n\n2) Retur Barang\nRetur dalam 7 hari.");
    expect(chunks.map((c) => c.heading)).toEqual(["PENGANTAR", "1.2 Cara Bayar", "2) Retur Barang"]);
    expect(chunks[0]!.content).toBe("Ini pengantar.");
  });

  it("splits an oversized paragraph at sentences, and hard-splits a sentence-less blob", () => {
    const big = para("besar", 60);
    const a = chunkText(big);
    expect(a.length).toBeGreaterThan(1);
    for (const c of a) expect(c.token_count).toBeLessThanOrEqual(500);
    const b = chunkText("x".repeat(5000));
    expect(b.length).toBeGreaterThan(2);
    for (const c of b) expect(c.token_count).toBeLessThanOrEqual(500);
  });

  it("leaves heading undefined before the first heading", () => {
    expect(chunkText("Tanpa judul sama sekali.")[0]!.heading).toBeUndefined();
  });
});

describe("chunkText heading edge cases", () => {
  for (const [name, nl] of [["LF", "\n"], ["CRLF", "\r\n"]] as const) {
    it(`keeps un-punctuated numbered SOP steps as body text (${name})`, () => {
      const chunks = chunkText(["PROSEDUR KASIR", "", "1. Buka menu", "2. Pilih produk", "3. Tekan bayar", ""].join(nl));
      expect(chunks.length).toBeGreaterThan(0);
      for (const c of chunks) expect(c.heading).toBe("PROSEDUR KASIR");
      const all = chunks.map((c) => c.content).join("\n");
      for (const step of ["Buka menu", "Pilih produk", "Tekan bayar"]) expect(all).toContain(step);
    });

    it(`emits a chunk for a heading with no body (${name})`, () => {
      const chunks = chunkText(`## Kontak Support${nl}`);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]!.content).toContain("Kontak Support");
      expect(chunks[0]!.heading).toBe("Kontak Support");
    });

    it(`still treats a lone numbered heading as a heading (${name})`, () => {
      const chunks = chunkText(`2. Penutupan Shift${nl}${nl}Kasir menghitung uang tunai.${nl}`);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]!.heading).toBe("2. Penutupan Shift");
      expect(chunks[0]!.content).toBe("Kasir menghitung uang tunai.");
    });
  }
});

describe("hash embedder", () => {
  it("is 384-dim, normalized, deterministic; zero for empty", async () => {
    const e = createHashEmbedder();
    const [a, a2, z] = await e.embed(["kasir buka toko", "kasir buka toko", ""], "passage");
    expect(a!.length).toBe(384);
    expect(Math.hypot(...a!)).toBeCloseTo(1, 5);
    expect(a2).toEqual(a);
    expect(z!.every((x) => x === 0)).toBe(true);
  });
  it("gives positive cosine for shared words", async () => {
    const e = createHashEmbedder();
    const [a, b] = await e.embed(["cara buka kasir", "buka kasir pagi"], "passage");
    const dot = a!.reduce((s, x, i) => s + x * b![i]!, 0);
    expect(dot).toBeGreaterThan(0);
  });
});

describe("local embedder prefixes", () => {
  it("adds e5 prefixes by kind and lazy-loads once", async () => {
    const seen: string[][] = [];
    let loads = 0;
    const emb = createLocalEmbedder({
      pipelineFactory: async () => {
        loads++;
        return async (texts: string[], opts: unknown) => {
          seen.push(texts);
          expect(opts).toEqual({ pooling: "mean", normalize: true });
          return { tolist: () => texts.map(() => [0.5, 0.5]) };
        };
      },
    });
    expect(emb.model).toBe("multilingual-e5-small");
    expect(loads).toBe(0);
    await emb.embed(["halo"], "query");
    await emb.embed(["a", "b"], "passage");
    expect(seen).toEqual([["query: halo"], ["passage: a", "passage: b"]]);
    expect(loads).toBe(1);
  });
});
