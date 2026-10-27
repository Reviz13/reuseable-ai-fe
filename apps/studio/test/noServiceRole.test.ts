import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const SKIP = new Set(["node_modules", ".next", "test"]);
// Built at runtime so this file does not match its own search.
const NEEDLE = ["SERVICE", "ROLE"].join("_");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe("studio holds only the anon key", () => {
  it("has no reference to the service role key", () => {
    const hits = walk(ROOT).filter((f) => readFileSync(f, "utf8").includes(NEEDLE));
    expect(hits).toEqual([]);
  });
});
