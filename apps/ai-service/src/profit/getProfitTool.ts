import { GetProfitArgsSchema, type GetProfitArgs, type ProfitReport, type ToolResult } from "@ai/contracts";
import type { ToolCtx, ToolDef } from "../tools/types.js";
import { resolvePeriod } from "./period.js";
import { UpstreamError } from "./posAdapter.js";

const FORBIDDEN_MSG = "Hanya owner yang dapat melihat profit.";
const UPSTREAM_MSG = "Data profit sedang tidak bisa diambil, coba lagi sebentar.";

type Data = { report: ProfitReport; label: string };

async function run(args: GetProfitArgs, ctx: ToolCtx): Promise<ToolResult<Data>> {
  const started = Date.now();
  const { claims } = ctx;
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
    return { ok: false, code: "FORBIDDEN", message: FORBIDDEN_MSG };
  }

  const period = resolvePeriod(args, claims.tz, ctx.now);
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
    return { ok: false, code: "UPSTREAM_ERROR", message: UPSTREAM_MSG };
  }
}

export const getProfitTool: ToolDef<GetProfitArgs, Data> = {
  name: "get_profit",
  description:
    "Ambil profit outlet untuk periode tertentu (hari ini, kemarin, minggu ini/lalu, bulan ini/lalu, atau rentang custom). Hanya untuk owner.",
  schema: GetProfitArgsSchema,
  run,
};
