import { writeFileSync } from "node:fs";
import { FAKE_SCRIPT_PATH, PROFIT_QUESTION, fetchThisWeekProfit, formatRupiah } from "./profit";

/**
 * Writes e2e/fake-script.json (gitignored) for ai-service's LLM_FAKE_SCRIPT.
 *
 * Format `{ byUserMessage: { "<last user message>": [round1Chunks, round2Chunks, ...] } }`
 * (src/llm/fake.ts). Keyed on the message, round = tool-call rounds so far in that turn, so replay does
 * not depend on request order across the owner and cashier turns.
 *
 * "Profit this week?" (both roles):
 *   round 1: get_profit {period:"this_week"}
 *   round 2: text with the exact profit mock-pos reports right now.
 * Owner: the guardrail sees a matching get_profit result and lets the text through.
 * Cashier: get_profit returns FORBIDDEN, so there is no profit result; the guardrail replaces the
 * rupiah text with the fixed FORBIDDEN copy. The cashier assertion therefore checks server behaviour,
 * not text the fake supplied.
 *
 * ai-service re-reads the file on every LLM call, so writing it after the server started is fine
 * (Playwright starts webServers before globalSetup).
 */
export default async function globalSetup(): Promise<void> {
  const { profit, from, to } = await fetchThisWeekProfit();
  const script = {
    byUserMessage: {
      [PROFIT_QUESTION]: [
        [
          { type: "tool_call", call: { id: "e2e-profit-1", name: "get_profit", args: { period: "this_week" } } },
          { type: "end", stop: "tool_use" },
        ],
        [
          { type: "text", text: `This week's profit is ${formatRupiah(profit)} (from ${from} to ${to}).` },
          { type: "end", stop: "end_turn" },
        ],
      ],
    },
  };
  writeFileSync(FAKE_SCRIPT_PATH, JSON.stringify(script, null, 2));
}
