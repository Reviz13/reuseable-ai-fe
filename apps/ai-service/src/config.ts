import { z } from "zod";
import { AppIdSchema, type AppId } from "@ai/contracts";

const optional = z.string().min(1).optional();
const IssuersSchema = z.record(AppIdSchema, z.string().url());

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  APP_ISSUERS: z.string().min(1),
  POS_BASE_URL: z.string().url(),
  POS_INTERNAL_KEY: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(4000),
  ANTHROPIC_API_KEY: optional,
  OPENAI_COMPAT_BASE_URL: optional,
  OPENAI_COMPAT_API_KEY: optional,
  WIDGET_DIR: z.string().min(1).default("../../packages/widget/dist"),
});

export interface Config {
  port: number;
  databaseUrl: string;
  supabaseUrl: string;
  supabaseServiceKey: string;
  appIssuers: Partial<Record<AppId, string>>;
  posBaseUrl: string;
  posInternalKey: string;
  anthropicApiKey?: string;
  openaiCompatBaseUrl?: string;
  openaiCompatApiKey?: string;
  widgetDir: string;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  // Empty strings (as in a copied .env.example) are treated as unset.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ""));
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${msg}`);
  }
  const e = parsed.data;
  let issuersRaw: unknown;
  try {
    issuersRaw = JSON.parse(e.APP_ISSUERS);
  } catch {
    throw new Error("Invalid configuration: APP_ISSUERS: must be valid JSON");
  }
  const issuers = IssuersSchema.safeParse(issuersRaw);
  if (!issuers.success) {
    throw new Error(`Invalid configuration: APP_ISSUERS: ${issuers.error.issues.map((i) => i.message).join("; ")}`);
  }
  return {
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    supabaseUrl: e.SUPABASE_URL,
    supabaseServiceKey: e.SUPABASE_SERVICE_ROLE_KEY,
    appIssuers: issuers.data,
    posBaseUrl: e.POS_BASE_URL,
    posInternalKey: e.POS_INTERNAL_KEY,
    anthropicApiKey: e.ANTHROPIC_API_KEY,
    openaiCompatBaseUrl: e.OPENAI_COMPAT_BASE_URL,
    openaiCompatApiKey: e.OPENAI_COMPAT_API_KEY,
    widgetDir: e.WIDGET_DIR,
  };
}
