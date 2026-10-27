import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractText } from "../src/rag/parse.js";

const fx = (n: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", n));

describe("extractText pdf", () => {
  it("does not fuse words across a page break", async () => {
    const text = await extractText(fx("two-page.pdf"), "application/pdf");
    expect(text).toContain("kasir");
    expect(text).toContain("menekan");
    expect(text).not.toContain("kasirmenekan");
  });
  it("scanned pdf trims to empty", async () => {
    expect((await extractText(fx("scanned.pdf"), "application/pdf")).trim()).toBe("");
  });
});
