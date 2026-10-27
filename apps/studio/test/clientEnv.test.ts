import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
// "use client" may follow blank lines and line/block comments.
const DIRECTIVE = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use client["']/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("client code never touches process.env", () => {
  // NEXT_PUBLIC_* is inlined at build time; a build made without env would bake in undefined.
  const files = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "lib")), ...walk(join(ROOT, "components"))];
  const client = files.filter((f) => DIRECTIVE.test(readFileSync(f, "utf8")));

  it("finds client files to check", () => {
    expect(client.length).toBeGreaterThan(0);
  });
  it("has zero process.env hits in them", () => {
    expect(client.filter((f) => readFileSync(f, "utf8").includes("process.env"))).toEqual([]);
  });
  it("detects a directive that follows a comment", () => {
    expect(DIRECTIVE.test('// note\n/* x */\n"use client";\n')).toBe(true);
    expect(DIRECTIVE.test('import x from "y";\n"use client";')).toBe(false);
  });
  it("browser supabase client takes url and key as parameters", () => {
    const src = readFileSync(join(ROOT, "lib/supabase-browser.ts"), "utf8");
    expect(src).not.toContain("process.env");
    expect(src).not.toContain("./env");
  });
});
