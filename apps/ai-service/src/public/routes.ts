import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import { AppIdSchema, AvatarStateSchema, PublicAssistantSchema, type PublicAssistant } from "@ai/contracts";
import { HttpError } from "../http.js";

const WIDGET_PREFIX = "/widget/v1/";

/**
 * Default frame for a state with no uploaded avatar. Served from the widget bundle
 * (`<widgetDir>/avatar/<state>.webp`, provided by Tasks 12/14).
 */
export const DEFAULT_AVATAR_PATH = (state: string) => `${WIDGET_PREFIX}avatar/${state}.webp`;

export function registerPublicRoutes(app: FastifyInstance): void {
  const { db, blob } = app.deps;

  app.get("/v1/assistants/:app/public", async (req) => {
    const parsed = AppIdSchema.safeParse((req.params as { app?: unknown }).app);
    if (!parsed.success) throw new HttpError(404, "assistant not found");
    const [row] = await db.query<{ app: string; name: string; theme: { accent?: string } | null; avatar_frames: Record<string, string> | null }>(
      "select app, name, theme, avatar_frames from assistants where app = $1",
      [parsed.data],
    );
    if (!row) throw new HttpError(404, "assistant not found");

    const origin = `${req.protocol}://${req.host}`;
    const frames = row.avatar_frames ?? {};
    const avatar_frames = Object.fromEntries(
      AvatarStateSchema.options.map((state) => {
        const stored = frames[state];
        if (!stored) return [state, `${origin}${DEFAULT_AVATAR_PATH(state)}`];
        // Stored as "<app>/<state>.webp?v=N": the cache-busting query is kept outside the storage path.
        const q = stored.indexOf("?");
        const path = q === -1 ? stored : stored.slice(0, q);
        const query = q === -1 ? "" : stored.slice(q);
        return [state, `${blob.publicUrl("avatars", path)}${query}`];
      }),
    );
    const body: PublicAssistant = {
      app: parsed.data,
      name: row.name,
      theme: { accent: row.theme?.accent ?? "#6d4aff" },
      avatar_frames: avatar_frames as PublicAssistant["avatar_frames"],
    };
    return PublicAssistantSchema.parse(body);
  });
}

/** Serves the built widget at /widget/v1/* when widgetDir exists (built in Task 12). */
export async function registerWidgetStatic(app: FastifyInstance, widgetDir: string | undefined): Promise<void> {
  const root = widgetDir ? resolve(widgetDir) : undefined;
  if (!root || !existsSync(root) || !statSync(root).isDirectory()) {
    app.log.info({ widgetDir: root ?? null }, "widget dir not found; /widget/v1/ not served");
    return;
  }
  await app.register(fastifyStatic, {
    root,
    prefix: WIDGET_PREFIX,
    cacheControl: false,
    setHeaders(res) {
      res.setHeader("cache-control", "public, max-age=300");
      // The widget script and default avatars are public and embedded from any host page.
      res.setHeader("access-control-allow-origin", "*");
    },
  });
}
