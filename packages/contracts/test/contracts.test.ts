import { describe, expect, it } from "vitest";
import {
  AssistantConfigSchema,
  ChatRequestSchema,
  ProfitReportSchema,
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

  it("ProfitReport.as_of accepts a UTC offset (S1)", () => {
    const r = {
      sales: 1, cogs: 1, profit: 0, transactions: 1, missing_cost_items: 0, currency: "IDR",
      from: "2026-10-27", to: "2026-10-27",
    };
    expect(ProfitReportSchema.safeParse({ ...r, as_of: "2026-10-27T12:00:00+07:00" }).success).toBe(true);
    expect(ProfitReportSchema.safeParse({ ...r, as_of: "2026-10-27T05:00:00.000Z" }).success).toBe(true);
    expect(ProfitReportSchema.safeParse({ ...r, as_of: "2026-10-27 12:00" }).success).toBe(false);
  });

  it("AssistantConfig stores allowed_origins as bare origins (S14)", () => {
    const cfg = {
      name: "Tepi", persona_prompt: "p", language: "id", llm_adapter: "claude", llm_model: "m",
      fallback_adapter: null, theme: { accent: "#123456" }, min_score: 0.78,
    };
    const out = AssistantConfigSchema.parse({
      ...cfg,
      allowed_origins: ["http://localhost:3000/", "https://pos.example.com/kasir?x=1", "HTTPS://POS.example.com:443"],
    });
    expect(out.allowed_origins).toEqual(["http://localhost:3000", "https://pos.example.com", "https://pos.example.com"]);
    expect(AssistantConfigSchema.safeParse({ ...cfg, allowed_origins: ["not a url"] }).success).toBe(false);
  });
});
