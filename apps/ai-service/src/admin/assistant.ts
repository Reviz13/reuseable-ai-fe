import { isDeepStrictEqual } from "node:util";
import type { FastifyInstance } from "fastify";
import { AppIdSchema, AssistantConfigSchema, AvatarStateSchema, type AssistantConfig } from "@ai/contracts";
import { createAuditWriter } from "../audit.js";
import { HttpError, parseRequest } from "../http.js";

const AVATAR_BUCKET = "avatars";
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

const ALLOWED_IMAGES: Record<string, string[]> = {
  ".png": ["image/png"],
  ".webp": ["image/webp"],
  ".jpg": ["image/jpeg", "image/jpg"],
  ".jpeg": ["image/jpeg", "image/jpg"],
};

const CONFIG_FIELDS = Object.keys(AssistantConfigSchema.shape) as (keyof AssistantConfig)[];
const SELECT_CONFIG = `select ${CONFIG_FIELDS.join(", ")}, avatar_frames, updated_at from assistants where app = $1`;

export function registerAssistantRoutes(app: FastifyInstance): void {
  const { deps } = app;
  const db = deps.db;
  const audit = createAuditWriter(db);

  for (const appId of AppIdSchema.options) {
    const guard = { preHandler: app.requireAdmin(appId) };

    const loadConfig = async () => {
      const [row] = await db.query<Record<string, unknown>>(SELECT_CONFIG, [appId]);
      if (!row) throw new HttpError(404, "not found");
      return row;
    };

    app.get(`/admin/${appId}/assistant`, guard, loadConfig);

    app.put(`/admin/${appId}/assistant`, guard, async (req) => {
      const started = Date.now();
      const cfg = parseRequest(AssistantConfigSchema, req.body);
      const before = await loadConfig();
      const [updated] = await db.query(
        `update assistants set name = $2, persona_prompt = $3, language = $4, llm_adapter = $5, llm_model = $6,
           fallback_adapter = $7, theme = $8::jsonb, allowed_origins = $9, min_score = $10,
           updated_at = now(), updated_by = $11
         where app = $1 returning app`,
        [
          appId,
          cfg.name,
          cfg.persona_prompt,
          cfg.language,
          cfg.llm_adapter,
          cfg.llm_model,
          cfg.fallback_adapter,
          JSON.stringify(cfg.theme),
          cfg.allowed_origins,
          cfg.min_score,
          req.admin.user_id,
        ],
      );
      if (!updated) throw new HttpError(404, "not found");
      app.invalidateCorsCache(appId);
      // Field names only: the persona prompt can be long and is not audit material.
      const changed = CONFIG_FIELDS.filter((f) => !isDeepStrictEqual(before[f], cfg[f]));
      await audit({
        app: appId,
        actor_type: "admin",
        actor_id: req.admin.user_id,
        action: "config.update",
        params: { changed },
        outcome: "ok",
        duration_ms: Date.now() - started,
      });
      return loadConfig();
    });

    app.put<{ Params: { state: string } }>(`/admin/${appId}/avatar/:state`, guard, async (req) => {
      const started = Date.now();
      const state = parseRequest(AvatarStateSchema, req.params.state);
      const part = await req.file({ limits: { fileSize: MAX_AVATAR_BYTES } });
      if (!part) throw new HttpError(400, "file is required");
      const filename = part.filename.split(/[\\/]/).pop() ?? "";
      const dot = filename.lastIndexOf(".");
      const ext = dot >= 0 ? filename.slice(dot).toLowerCase() : "";
      const mime = part.mimetype.split(";")[0]!.trim().toLowerCase();
      if (!ALLOWED_IMAGES[ext]?.includes(mime)) {
        part.file.resume();
        throw new HttpError(415, "unsupported image type");
      }
      const buf = await part.toBuffer(); // throws 413 past 5 MB
      let out: Buffer;
      try {
        // Lazy import keeps the native module off the startup path of non-avatar code.
        const { default: sharp } = await import("sharp");
        // Pixel cap guards against decompression bombs: a tiny PNG can declare a huge canvas.
        out = await sharp(buf, { limitInputPixels: 4096 * 4096, failOn: "error" })
          .resize(256, 256, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .webp()
          .toBuffer();
      } catch {
        throw new HttpError(400, "invalid image");
      }
      const path = `${appId}/${state}.webp`;
      await deps.blob.put(AVATAR_BUCKET, path, out, "image/webp");
      const frame = `${path}?v=${deps.now().getTime()}`;
      const [row] = await db.query<{ avatar_frames: Record<string, string> }>(
        `update assistants set avatar_frames = jsonb_set(avatar_frames, array[$2::text], to_jsonb($3::text)),
           updated_at = now(), updated_by = $4
         where app = $1 returning avatar_frames`,
        [appId, state, frame, req.admin.user_id],
      );
      if (!row) throw new HttpError(404, "not found");
      await audit({
        app: appId,
        actor_type: "admin",
        actor_id: req.admin.user_id,
        action: "avatar.update",
        params: { state },
        outcome: "ok",
        duration_ms: Date.now() - started,
      });
      return { avatar_frames: row.avatar_frames };
    });
  }
}
