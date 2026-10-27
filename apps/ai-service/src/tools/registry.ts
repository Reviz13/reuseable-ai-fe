import { zodToJsonSchema } from "zod-to-json-schema";
import type { AppId } from "@ai/contracts";
import { getProfitTool } from "../profit/getProfitTool.js";
import type { ToolDef } from "./types.js";

export type { ToolCtx, ToolDef } from "./types.js";

export function toolsFor(app: AppId): ToolDef[] {
  return app === "pos" ? [getProfitTool] : [];
}

export function toJsonSchema(tool: ToolDef): { name: string; description: string; input_schema: Record<string, unknown> } {
  const { $schema: _omit, ...input_schema } = zodToJsonSchema(tool.schema, { target: "jsonSchema7", $refStrategy: "none" }) as Record<string, unknown>;
  return { name: tool.name, description: tool.description, input_schema };
}
