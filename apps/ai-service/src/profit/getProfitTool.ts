import { GetProfitArgsSchema, type GetProfitArgs, type ProfitReport, type ToolResult } from "@ai/contracts";
import { copyFor } from "../copy.js";
import type { ToolCtx, ToolDef } from "../tools/types.js";
import { resolvePeriod } from "./period.js";
import { UpstreamError } from "./posAdapter.js";

type Data = { report: ProfitReport; label: string };

async function run(args: GetProfitArgs, ctx: ToolCtx): Promise<ToolResult<Data>> {
  const started = Date.now();
  const { claims } = ctx;
  const copy = ctx.copy ?? copyFor("id");
  let from: string | null = null;
  let to: string | null = null;

  const audit = (outcome: "ok" | "forbidden" | "error", error_code?: string) =>
    ctx.audit({
      app: claims.iss,
      actor_type: "end_user",
      actor_id: claims.sub,
      outlet_id: claims.outlet_id,
      action: "tool.get_profit",
      params: { period: args.period, from, to },
      outcome,
      error_code,
      duration_ms: Date.now() - started,
    });

  if (claims.role !== "owner") {
    await audit("forbidden", "FORBIDDEN");
    return { ok: false, code: "FORBIDDEN", message: copy.FORBIDDEN };
  }

  const period = resolvePeriod(args, claims.tz, ctx.now, copy);
  if ("error" in period) {
    await audit("error", "INVALID_PERIOD");
    return { ok: false, code: "INVALID_PERIOD", message: period.error };
  }
  ({ from, to } = period);

  try {
    const report = await ctx.pos.getProfit(claims.outlet_id, period.from, period.to, ctx.signal);
    await audit("ok");
    return { ok: true, data: { report, label: period.label } };
  } catch (err) {
    if (ctx.signal.aborted) {
      // Client disconnect: every POS call is audited, then the abort propagates.
      await audit("error", "ABORTED");
      throw err;
    }
    if (!(err instanceof UpstreamError)) throw err; // bugs propagate
    await audit("error", "UPSTREAM_ERROR");
    return { ok: false, code: "UPSTREAM_ERROR", message: copy.UPSTREAM };
  }
}

export const getProfitTool: ToolDef<GetProfitArgs, Data> = {
  name: "get_profit",
  description:
    "Get the outlet's profit, sales and COGS for a period: today, yesterday, this/last week, this/last month, or custom with start_date and end_date (YYYY-MM-DD; a single day has the same start and end). Owner only.",
  schema: GetProfitArgsSchema,
  run,
};
