import { z } from "zod";
import { AppIdSchema, AvatarStateSchema } from "./common";

export const PublicAssistantSchema = z.object({
  app: AppIdSchema,
  name: z.string(),
  theme: z.object({ accent: z.string() }),
  avatar_frames: z.record(AvatarStateSchema, z.string().url()),
});
export type PublicAssistant = z.infer<typeof PublicAssistantSchema>;

export const FaqInputSchema = z.object({
  question: z.string().min(1).max(500),
  answer: z.string().min(1).max(5000),
});
export type FaqInput = z.infer<typeof FaqInputSchema>;

export const AssistantConfigSchema = z.object({
  name: z.string(),
  persona_prompt: z.string(),
  language: z.string(),
  llm_adapter: z.enum(["claude", "openai_compat"]),
  llm_model: z.string(),
  fallback_adapter: z.enum(["claude", "openai_compat"]).nullable(),
  theme: z.object({ accent: z.string() }),
  allowed_origins: z.array(z.string().url()),
  min_score: z.number().min(0).max(1),
});
export type AssistantConfig = z.infer<typeof AssistantConfigSchema>;

export const AuditQuerySchema = z.object({
  action: z.string().optional(),
  outcome: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type AuditQuery = z.infer<typeof AuditQuerySchema>;
