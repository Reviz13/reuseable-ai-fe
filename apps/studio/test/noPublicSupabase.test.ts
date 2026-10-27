import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const NEEDLE = ["NEXT_PUBLIC", "SUPABASE"].join("_");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe("studio env names", () => {
  it("never references the build-time-inlined public Supabase vars", () => {
    expect(walk(ROOT).filter((f) => readFileSync(f, "utf8").includes(NEEDLE))).toEqual([]);
  });
});
