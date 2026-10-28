import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "../../src/app.js";
import { createMemoryBlobStore, type BlobStore } from "../../src/blob.js";
import { multipart } from "./helpers.js";
import { createTestDb } from "./pglite.js";

const here = dirname(fileURLToPath(import.meta.url));
const avatar = (state: string) => readFileSync(join(here, "../../../../assets/avatar/pos", `${state}.webp`));
const ADMIN = "11111111-1111-1111-1111-111111111111";
const NOPOS = "33333333-3333-3333-3333-333333333333";
const NOW = new Date("2026-03-04T05:06:07.000Z");

let h: Awaited<ReturnType<typeof createTestDb>>;
let app: FastifyInstance;
let blob: BlobStore;

beforeAll(async () => {
  h = await createTestDb();
  blob = createMemoryBlobStore();
  await h.pg.exec(`insert into auth.users (id, email) values ('${ADMIN}','a@x'),('${NOPOS}','n@x');`);
  app = createApp({
    config: {} as never,
    db: h.db,
    blob,
    verifyEndUser: async () => {
      throw new Error("unused");
    },
    verifyAdmin: async (t) => (t === "admin" ? { user_id: ADMIN, apps: ["pos"] } : { user_id: NOPOS, apps: ["banking"] }),
    now: () => NOW,
  });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await h.close();
});

const get = (url: string, token = "admin") => app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
const send = (method: "POST" | "PUT", url: string, payload?: object, token = "admin") =>
  app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload });
const putAvatar = (state: string, filename: string, buf: Buffer, ct: string) => {
  const m = multipart(filename, buf, ct);
  return app.inject({
    method: "PUT",
    url: `/admin/pos/avatar/${state}`,
    headers: { ...m.headers, authorization: "Bearer admin" },
    payload: m.payload,
  });
};

const validConfig = () => ({
  name: "Kopi Bot",
  persona_prompt: "SECRET-PERSONA-TEXT ramah dan singkat",
  language: "en",
  llm_adapter: "claude" as const,
  llm_model: "claude-sonnet-5-5",
  fallback_adapter: null,
  theme: { accent: "#112233" },
  allowed_origins: ["https://pos.example.com"],
  min_score: 0.5,
});

describe("assistant config", () => {
  it("rejects min_score 1.5 with 400 and persists nothing", async () => {
    const r = await send("PUT", "/admin/pos/assistant", { ...validConfig(), min_score: 1.5 });
    expect(r.statusCode).toBe(400);
    const g = (await get("/admin/pos/assistant")).json() as { min_score: number };
    expect(g.min_score).not.toBe(1.5);
  });

  it("valid PUT persists, sets updated_by, audits field names only, invalidates CORS cache", async () => {
    let invalidated = "";
    const orig = app.invalidateCorsCache;
    app.invalidateCorsCache = (a: string) => {
      invalidated = a;
      orig(a);
    };
    const r = await send("PUT", "/admin/pos/assistant", validConfig());
    app.invalidateCorsCache = orig;
    expect(r.statusCode).toBe(200);
    expect(invalidated).toBe("pos");
    const g = (await get("/admin/pos/assistant")).json() as Record<string, unknown>;
    expect(g.name).toBe("Kopi Bot");
    expect(g.min_score).toBeCloseTo(0.5);
    expect(g.allowed_origins).toEqual(["https://pos.example.com"]);
    expect(g).toHaveProperty("avatar_frames");
    expect(g).toHaveProperty("updated_at");
    const [row] = await h.db.query<{ updated_by: string }>("select updated_by from assistants where app = 'pos'");
    expect(row!.updated_by).toBe(ADMIN);
    const audits = await h.db.query<{ params: { changed: string[] }; actor_type: string }>(
      "select params, actor_type from audit_log where app = 'pos' and action = 'config.update'",
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actor_type).toBe("admin");
    expect(audits[0]!.params.changed).toContain("persona_prompt");
    expect(audits[0]!.params.changed).toContain("name");
    expect(audits[0]!.params.changed).not.toContain("language");
    expect(Object.keys(audits[0]!.params)).toEqual(["changed"]);
    expect(JSON.stringify(audits[0]!.params)).not.toContain("SECRET-PERSONA-TEXT");
  });

  it("is 403 for an admin without pos", async () => {
    expect((await get("/admin/pos/assistant", "nopos")).statusCode).toBe(403);
    expect((await send("PUT", "/admin/pos/assistant", validConfig(), "nopos")).statusCode).toBe(403);
  });
  it("stores allowed_origins as bare origins, so a trailing slash still matches the Origin header (S14)", async () => {
    const r = await send("PUT", "/admin/pos/assistant", { ...validConfig(), allowed_origins: ["http://localhost:3000/"] });
    expect(r.statusCode).toBe(200);
    const [row] = await h.db.query<{ allowed_origins: string[] }>("select allowed_origins from assistants where app = 'pos'");
    expect(row!.allowed_origins).toEqual(["http://localhost:3000"]);
  });
});

describe("avatar upload", () => {
  it("resizes to a 256x256 webp, stores it and sets avatar_frames.idle with cache-bust", async () => {
    const r = await putAvatar("idle", "idle.webp", avatar("idle"), "image/webp");
    expect(r.statusCode).toBe(200);
    const stored = await blob.get("avatars", "pos/idle.webp");
    const meta = await sharp(stored).metadata();
    expect(meta.format).toBe("webp");
    expect([meta.width, meta.height]).toEqual([256, 256]);
    const [row] = await h.db.query<{ avatar_frames: Record<string, string> }>("select avatar_frames from assistants where app = 'pos'");
    expect(row!.avatar_frames.idle).toBe(`pos/idle.webp?v=${NOW.getTime()}`);
    expect((r.json() as { avatar_frames: Record<string, string> }).avatar_frames.idle).toBe(row!.avatar_frames.idle);
  });

  it("leaves other states untouched and audits avatar.update with {state}", async () => {
    await putAvatar("happy", "h.webp", avatar("happy"), "image/webp");
    const [row] = await h.db.query<{ avatar_frames: Record<string, string> }>("select avatar_frames from assistants where app = 'pos'");
    expect(Object.keys(row!.avatar_frames).sort()).toEqual(["happy", "idle"]);
    const a = await h.db.query<{ params: unknown }>("select params from audit_log where action = 'avatar.update' order by at");
    expect(a.map((x) => x.params)).toContainEqual({ state: "happy" });
  });

  it("accepts png and jpg", async () => {
    const png = await sharp({ create: { width: 40, height: 20, channels: 3, background: "#f00" } }).png().toBuffer();
    const jpg = await sharp({ create: { width: 40, height: 20, channels: 3, background: "#0f0" } }).jpeg().toBuffer();
    expect((await putAvatar("sad", "a.png", png, "image/png")).statusCode).toBe(200);
    expect((await putAvatar("talking", "a.jpeg", jpg, "image/jpeg")).statusCode).toBe(200);
    const meta = await sharp(await blob.get("avatars", "pos/sad.webp")).metadata();
    expect([meta.width, meta.height]).toEqual([256, 256]);
  });

  it("invalid state angry is 400", async () => {
    expect((await putAvatar("angry", "a.webp", avatar("idle"), "image/webp")).statusCode).toBe(400);
  });

  it("a gif is 415, a mime/extension mismatch is 415", async () => {
    expect((await putAvatar("idle", "a.gif", Buffer.from("GIF89a"), "image/gif")).statusCode).toBe(415);
    expect((await putAvatar("idle", "a.png", avatar("idle"), "image/gif")).statusCode).toBe(415);
  });

  it("a corrupt image is 400", async () => {
    expect((await putAvatar("idle", "bad.png", Buffer.from("not really a png"), "image/png")).statusCode).toBe(400);
  });

  it("a small PNG declaring a huge canvas is 400 and changes nothing", async () => {
    const bomb = await sharp({ create: { width: 5000, height: 5000, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(bomb.length).toBeLessThan(5 * 1024 * 1024);
    const before = await h.db.query("select avatar_frames from assistants where app = 'pos'");
    expect((await putAvatar("idle", "bomb.png", bomb, "image/png")).statusCode).toBe(400);
    expect(await h.db.query("select avatar_frames from assistants where app = 'pos'")).toEqual(before);
  });

  it("over 5 MB is 413", async () => {
    expect((await putAvatar("idle", "big.png", Buffer.alloc(5 * 1024 * 1024 + 10, 1), "image/png")).statusCode).toBe(413);
  });
});

describe("insights", () => {
  it("gaps: lists unresolved newest first, resolves, filters by resolved, cross-app 404", async () => {
    const [g1] = await h.db.query<{ id: string }>(
      "insert into knowledge_gaps (app, question, top_score, created_at) values ('pos','lama?',0.3,'2026-01-01') returning id",
    );
    const [g2] = await h.db.query<{ id: string }>(
      "insert into knowledge_gaps (app, question, top_score, created_at) values ('pos','baru?',0.2,'2026-02-01') returning id",
    );
    const [other] = await h.db.query<{ id: string }>("insert into knowledge_gaps (app, question) values ('banking','x?') returning id");
    const list = (await get("/admin/pos/gaps")).json() as { id: string; question: string }[];
    expect(list.map((g) => g.id)).toEqual([g2!.id, g1!.id]);
    expect(Object.keys(list[0]!).sort()).toEqual(["created_at", "id", "question", "resolved_at", "top_score"]);

    expect((await send("POST", `/admin/pos/gaps/${other!.id}/resolve`)).statusCode).toBe(404);
    expect((await send("POST", `/admin/pos/gaps/not-a-uuid/resolve`)).statusCode).toBe(404);
    const [still] = await h.db.query<{ resolved_at: string | null }>("select resolved_at from knowledge_gaps where id = $1", [other!.id]);
    expect(still!.resolved_at).toBeNull();

    expect((await send("POST", `/admin/pos/gaps/${g1!.id}/resolve`)).statusCode).toBe(200);
    expect(((await get("/admin/pos/gaps")).json() as { id: string }[]).map((g) => g.id)).toEqual([g2!.id]);
    const done = (await get("/admin/pos/gaps?resolved=true")).json() as { id: string; resolved_at: string }[];
    expect(done.map((g) => g.id)).toEqual([g1!.id]);
    expect(done[0]!.resolved_at).toBeTruthy();
    const [first] = await h.db.query<{ resolved_at: string }>("select resolved_at from knowledge_gaps where id = $1", [g1!.id]);
    const again = await send("POST", `/admin/pos/gaps/${g1!.id}/resolve`);
    expect(again.statusCode).toBe(200);
    const [second] = await h.db.query<{ resolved_at: string }>("select resolved_at from knowledge_gaps where id = $1", [g1!.id]);
    expect(second!.resolved_at).toEqual(first!.resolved_at);
    expect((await get("/admin/pos/gaps?resolved=maybe")).statusCode).toBe(400);
    const a = await h.db.query("select 1 from audit_log where action = 'gap.resolve' and app = 'pos'");
    expect(a).toHaveLength(1);
  });

  it("feedback: joins answer and the latest preceding user question, scoped by app", async () => {
    const [c] = await h.db.query<{ id: string }>("insert into conversations (app, user_id) values ('pos','u1') returning id");
    const [cb] = await h.db.query<{ id: string }>("insert into conversations (app, user_id) values ('banking','u2') returning id");
    const ins = async (conv: string, role: string, content: string, at: string) =>
      (
        await h.db.query<{ id: string }>(
          "insert into messages (conversation_id, role, content, created_at) values ($1,$2,$3,$4) returning id",
          [conv, role, content, at],
        )
      )[0]!.id;
    await ins(c!.id, "user", "pertanyaan pertama", "2026-02-01T10:00:00Z");
    const a1 = await ins(c!.id, "assistant", "jawaban pertama", "2026-02-01T10:00:05Z");
    await ins(c!.id, "user", "pertanyaan kedua", "2026-02-01T10:01:00Z");
    const a2 = await ins(c!.id, "assistant", "jawaban kedua", "2026-02-01T10:01:05Z");
    await ins(cb!.id, "user", "tanya bank", "2026-02-01T10:00:00Z");
    const ba = await ins(cb!.id, "assistant", "jawab bank", "2026-02-01T10:00:05Z");
    await h.db.query(
      "insert into feedback (message_id, rating, comment, created_at) values ($1,-1,'salah','2026-02-02'),($2,-1,null,'2026-02-03'),($3,-1,null,'2026-02-04')",
      [a1, a2, ba],
    );
    const good = await ins(c!.id, "assistant", "jawaban bagus", "2026-02-01T10:02:00Z");
    await h.db.query("insert into feedback (message_id, rating) values ($1, 1)", [good]);

    const neg = (await get("/admin/pos/feedback")).json() as { answer: string; question: string; comment: string | null }[];
    expect(neg.map((f) => [f.answer, f.question])).toEqual([
      ["jawaban kedua", "pertanyaan kedua"],
      ["jawaban pertama", "pertanyaan pertama"],
    ]);
    expect(Object.keys(neg[0]!).sort()).toEqual(["answer", "comment", "created_at", "message_id", "question", "rating"]);
    expect(neg[1]!.comment).toBe("salah");
    const up = (await get("/admin/pos/feedback?rating=1")).json() as { answer: string }[];
    expect(up.map((f) => f.answer)).toEqual(["jawaban bagus"]);
    expect((await get("/admin/pos/feedback?rating=5")).statusCode).toBe(400);
  });

  it("audit: filters by outcome, action and inclusive day range, newest first, app-scoped", async () => {
    await h.db.query(
      `insert into audit_log (at, app, actor_type, action, outcome, duration_ms) values
       ('2026-05-01T00:00:00Z','pos','end_user','tool.x','forbidden',1),
       ('2026-05-02T23:59:59Z','pos','end_user','tool.y','ok',1),
       ('2026-05-03T12:00:00Z','pos','end_user','tool.z','forbidden',1),
       ('2026-05-02T12:00:00Z','banking','end_user','tool.q','forbidden',1)`,
    );
    const f = (await get("/admin/pos/audit?outcome=forbidden")).json() as { action: string; outcome: string; app: string }[];
    expect(f.length).toBeGreaterThan(0);
    expect(f.every((r) => r.outcome === "forbidden" && r.app === "pos")).toBe(true);
    expect(f.map((r) => r.action).slice(0, 2)).toEqual(["tool.z", "tool.x"]);
    const day = (await get("/admin/pos/audit?from=2026-05-02&to=2026-05-02")).json() as { action: string }[];
    expect(day.map((r) => r.action)).toEqual(["tool.y"]);
    const act = (await get("/admin/pos/audit?action=tool.z")).json() as { action: string }[];
    expect(act.map((r) => r.action)).toEqual(["tool.z"]);
    expect(((await get("/admin/pos/audit?limit=1")).json() as unknown[]).length).toBe(1);
    expect((await get("/admin/pos/audit?limit=9999")).statusCode).toBe(400);
    expect((await get("/admin/pos/audit?from=garbage")).statusCode).toBe(400);
  });
});
