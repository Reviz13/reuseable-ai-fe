import { z } from "zod";
import { AppIdSchema, type AppId } from "@ai/contracts";

const optional = z.string().min(1).optional();
const IssuersSchema = z.record(AppIdSchema, z.string().url());

const EnvSchema = z.object({
  NODE_ENV: optional,
  /** Ruling 45: dev-only in-process mode (PGlite, memory blob, hash embedder). Refused in production. */
  LOCAL_MODE: optional,
  /** Test hook: path to a fake LLM script (see src/llm/fake.ts). Ignored when NODE_ENV=production. */
  LLM_FAKE_SCRIPT: optional,
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

// LOCAL_MODE needs no database or Supabase project.
const LocalEnvSchema = EnvSchema.extend({
  DATABASE_URL: optional,
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: optional,
});

export interface Config {
  port: number;
  /** Ruling 45: LOCAL_MODE=1. Never true with NODE_ENV=production (loadConfig throws instead). */
  localMode: boolean;
  /** LLM_FAKE_SCRIPT; always undefined when NODE_ENV=production. */
  llmFakeScript?: string;
  /** Empty in local mode. */
  databaseUrl: string;
  /** Empty in local mode. */
  supabaseUrl: string;
  /** Empty in local mode. */
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
  const production = cleaned.NODE_ENV === "production";
  const localMode = cleaned.LOCAL_MODE === "1";
  if (localMode && production) {
    throw new Error("Invalid configuration: LOCAL_MODE=1 is dev-only and refused when NODE_ENV=production");
  }
  const parsed = (localMode ? LocalEnvSchema : EnvSchema).safeParse(cleaned);
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
    localMode,
    llmFakeScript: production ? undefined : e.LLM_FAKE_SCRIPT,
    databaseUrl: e.DATABASE_URL ?? "",
    supabaseUrl: e.SUPABASE_URL ?? "",
    supabaseServiceKey: e.SUPABASE_SERVICE_ROLE_KEY ?? "",
    appIssuers: issuers.data,
    posBaseUrl: e.POS_BASE_URL,
    posInternalKey: e.POS_INTERNAL_KEY,
    anthropicApiKey: e.ANTHROPIC_API_KEY,
    openaiCompatBaseUrl: e.OPENAI_COMPAT_BASE_URL,
    openaiCompatApiKey: e.OPENAI_COMPAT_API_KEY,
    widgetDir: e.WIDGET_DIR,
  };
}
