import type { z } from "zod";
import type { JwtClaims, ToolResult } from "@ai/contracts";
import type { AuditWriter } from "../audit.js";
import type { PosAdapter } from "../profit/posAdapter.js";

export interface ToolCtx {
  claims: JwtClaims;
  now: Date;
  signal: AbortSignal;
  audit: AuditWriter;
  pos: PosAdapter;
}

export interface ToolDef<A = any, R = any> {
  name: string;
  description: string;
  schema: z.ZodType<A, z.ZodTypeDef, any>;
  run(args: A, ctx: ToolCtx): Promise<ToolResult<R>>;
}
