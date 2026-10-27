import { describe, expect, it, vi } from "vitest";

const ctor = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { stream: vi.fn() };
    constructor(opts: unknown) {
      ctor(opts);
    }
  },
}));

const { createClaudeAdapter } = await import("../src/llm/claude.js");

describe("claude client construction (Ruling 17)", () => {
  it("disables SDK retries so they do not stack under withFallback", () => {
    createClaudeAdapter("sk-test");
    expect(ctor).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "sk-test", maxRetries: 0 }));
  });
});
