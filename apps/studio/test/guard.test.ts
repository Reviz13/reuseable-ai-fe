import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("next/navigation", () => ({ notFound, redirect: vi.fn() }));
vi.mock("../lib/supabase", () => ({ createServerSupabase: vi.fn() }));

import { parseApp } from "../lib/guard";

describe("parseApp", () => {
  it("returns a valid AppId", () => {
    expect(parseApp("pos")).toBe("pos");
    expect(parseApp("banking")).toBe("banking");
  });
  it("calls notFound for anything else", () => {
    for (const bad of ["nope", "POS", "", "pos/../x"]) {
      expect(() => parseApp(bad)).toThrow("NEXT_NOT_FOUND");
    }
    expect(notFound).toHaveBeenCalled();
  });
});
