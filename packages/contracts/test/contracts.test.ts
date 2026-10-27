import { describe, expect, it } from "vitest";
import {
  ChatRequestSchema,
  GetProfitArgsSchema,
  JwtClaimsSchema,
  encodeSse,
} from "../src/index";

describe("contracts", () => {
  it("ChatRequest rejects too long and blank, accepts normal", () => {
    expect(ChatRequestSchema.safeParse({ app: "pos", message: "a".repeat(2001) }).success).toBe(false);
    expect(ChatRequestSchema.safeParse({ app: "pos", message: "   " }).success).toBe(false);
    expect(ChatRequestSchema.safeParse({ app: "pos", message: "Profit minggu ini?" }).success).toBe(true);
  });

  it("GetProfitArgs requires both dates for custom", () => {
    expect(GetProfitArgsSchema.safeParse({ period: "custom" }).success).toBe(false);
    expect(
      GetProfitArgsSchema.safeParse({ period: "custom", start_date: "2026-10-01", end_date: "2026-10-07" }).success,
    ).toBe(true);
  });

  it("JwtClaims rejects wrong aud", () => {
    const base = { iss: "pos", sub: "u1", outlet_id: "o1", role: "owner", tz: "Asia/Jakarta", exp: 1, jti: "j" };
    expect(JwtClaimsSchema.safeParse({ ...base, aud: "ai-platform" }).success).toBe(true);
    expect(JwtClaimsSchema.safeParse({ ...base, aud: "other" }).success).toBe(false);
  });

  it("encodeSse formats an event", () => {
    expect(encodeSse({ type: "token", text: "hi" })).toBe('event: token\ndata: {"type":"token","text":"hi"}\n\n');
  });
});
