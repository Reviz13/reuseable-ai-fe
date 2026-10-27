import { z } from "zod";
import { AvatarStateSchema } from "@ai/contracts";

export const DocumentRowSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  status: z.string(),
  active_version_id: z.string().nullable(),
  active_version: z.number().nullable(),
  created_at: z.string(),
});
export type DocumentRow = z.infer<typeof DocumentRowSchema>;
export const DocumentListSchema = z.array(DocumentRowSchema);

export const DocumentDetailSchema = DocumentRowSchema.extend({
  faq: z.object({ question: z.string(), answer: z.string() }).nullable().optional(),
  versions: z.array(
    z.object({
      id: z.string(),
      version: z.number(),
      checksum: z.string(),
      error: z.string().nullable(),
      created_at: z.string(),
      chunk_count: z.number(),
    }),
  ),
});

export const AssistantAdminSchema = z.object({
  name: z.string(),
  persona_prompt: z.string(),
  language: z.string(),
  llm_adapter: z.enum(["claude", "openai_compat"]),
  llm_model: z.string(),
  fallback_adapter: z.enum(["claude", "openai_compat"]).nullable(),
  theme: z.object({ accent: z.string() }),
  allowed_origins: z.array(z.string()),
  min_score: z.coerce.number(),
  avatar_frames: z.record(z.string(), z.string()).default({}),
});
export type AssistantAdmin = z.infer<typeof AssistantAdminSchema>;

export const PublicAssistantLooseSchema = z.object({
  avatar_frames: z.record(AvatarStateSchema, z.string()).default({}),
});

export const GapSchema = z.array(
  z.object({
    id: z.string(),
    question: z.string(),
    top_score: z.coerce.number().nullable(),
    created_at: z.string(),
    resolved_at: z.string().nullable(),
  }),
);

export const FeedbackSchema = z.array(
  z.object({
    message_id: z.string(),
    rating: z.number(),
    comment: z.string().nullable(),
    created_at: z.string(),
    answer: z.string(),
    question: z.string().nullable(),
  }),
);

export const AuditSchema = z.array(
  z.object({
    id: z.union([z.string(), z.number()]),
    at: z.string(),
    actor_type: z.string(),
    actor_id: z.string().nullable(),
    action: z.string(),
    params: z.unknown(),
    outcome: z.string(),
    error_code: z.string().nullable(),
    duration_ms: z.number().nullable(),
  }),
);
