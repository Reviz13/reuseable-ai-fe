import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPosition, nearestCorner, savePosition } from "../src/position";

afterEach(() => vi.restoreAllMocks());

describe("nearestCorner", () => {
  it("maps points to corners", () => {
    expect(nearestCorner(10, 10, 1000, 800)).toBe("top-left");
    expect(nearestCorner(990, 790, 1000, 800)).toBe("bottom-right");
    expect(nearestCorner(990, 10, 1000, 800)).toBe("top-right");
    expect(nearestCorner(10, 790, 1000, 800)).toBe("bottom-left");
  });
});

describe("position storage", () => {
  it("round-trips under the namespaced key", () => {
    savePosition("pos", "top-left");
    expect(localStorage.getItem("ai-assistant:pos:position")).toBe("top-left");
    expect(loadPosition("pos")).toBe("top-left");
  });
  it("ignores invalid stored values", () => {
    localStorage.setItem("ai-assistant:pos:position", "middle");
    expect(loadPosition("pos")).toBeNull();
  });
  it("never throws when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(loadPosition("pos")).toBeNull();
    expect(() => savePosition("pos", "top-left")).not.toThrow();
  });
});
