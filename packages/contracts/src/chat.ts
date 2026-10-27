import { z } from "zod";
import { AppIdSchema, AvatarStateSchema } from "./common";

export const ChatRequestSchema = z.object({
  app: AppIdSchema,
  conversation_id: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(2000),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const SseEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("state"), avatar: AvatarStateSchema }),
  z.object({ type: z.literal("token"), text: z.string() }),
  z.object({
    type: z.literal("tool"),
    name: z.string(),
    status: z.enum(["start", "ok", "error"]),
  }),
  z.object({
    type: z.literal("citation"),
    document_id: z.string(),
    title: z.string(),
    heading: z.string().optional(),
    version: z.number().int(),
  }),
  z.object({ type: z.literal("done"), message_id: z.string(), conversation_id: z.string() }),
  z.object({
    type: z.literal("error"),
    code: z.enum(["UNAUTHORIZED", "RATE_LIMITED", "LLM_UNAVAILABLE", "INTERNAL", "BAD_REQUEST"]),
    message: z.string(),
  }),
]);
export type SseEvent = z.infer<typeof SseEventSchema>;

export function encodeSse(e: SseEvent): string {
  return `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
}

export const FeedbackRequestSchema = z.object({
  message_id: z.string().uuid(),
  rating: z.union([z.literal(-1), z.literal(1)]),
  comment: z.string().max(1000).optional(),
});
export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>;
