import { z } from "zod";

export const ProfitPeriodSchema = z.enum([
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "custom",
]);
export type ProfitPeriod = z.infer<typeof ProfitPeriodSchema>;

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const GetProfitArgsSchema = z
  .object({
    period: ProfitPeriodSchema,
    start_date: DateStr.optional(),
    end_date: DateStr.optional(),
  })
  .refine((a) => a.period !== "custom" || (a.start_date && a.end_date), {
    message: "custom period requires start_date and end_date",
    path: ["period"],
  });
export type GetProfitArgs = z.infer<typeof GetProfitArgsSchema>;

export const ProfitReportSchema = z.object({
  sales: z.number(),
  cogs: z.number(),
  profit: z.number(),
  transactions: z.number(),
  missing_cost_items: z.number().int(),
  currency: z.literal("IDR"),
  from: DateStr,
  to: DateStr,
  // S1: POS clocks may report a local offset ("+07:00").
  as_of: z.string().datetime({ offset: true }),
});
export type ProfitReport = z.infer<typeof ProfitReportSchema>;

export type ToolResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: "FORBIDDEN" | "INVALID_PERIOD" | "UPSTREAM_ERROR"; message: string };
