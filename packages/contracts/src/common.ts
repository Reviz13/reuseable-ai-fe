import { z } from "zod";

export const AppIdSchema = z.enum(["pos", "banking", "erp"]);
export type AppId = z.infer<typeof AppIdSchema>;

export const TzSchema = z.enum(["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"]);
export type Tz = z.infer<typeof TzSchema>;

export const AvatarStateSchema = z.enum(["idle", "thinking", "talking", "happy", "sad"]);
export type AvatarState = z.infer<typeof AvatarStateSchema>;

export const JwtClaimsSchema = z.object({
  iss: AppIdSchema,
  aud: z.literal("ai-platform"),
  sub: z.string(),
  outlet_id: z.string(),
  role: z.string(),
  tz: TzSchema,
  exp: z.number(),
  jti: z.string(),
});
export type JwtClaims = z.infer<typeof JwtClaimsSchema>;
