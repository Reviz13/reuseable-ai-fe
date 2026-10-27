import { encodeSse, type SseEvent } from "@ai/contracts";

export const FRAMES = {
  idle: "http://x/idle.webp",
  thinking: "http://x/thinking.webp",
  talking: "http://x/talking.webp",
  happy: "http://x/happy.webp",
  sad: "http://x/sad.webp",
};

export const PUBLIC = { app: "pos", name: "Kopi Bot", theme: { accent: "#123456" }, avatar_frames: FRAMES };

/** Streaming SSE response; the stream stays open until `close()` when `hold` is set. */
export function sseResponse(events: SseEvent[], opts: { hold?: boolean; split?: number } = {}) {
  const enc = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      const text = events.map(encodeSse).join("");
      const n = opts.split ?? (text.length || 1);
      for (let i = 0; i < text.length; i += n) c.enqueue(enc.encode(text.slice(i, i + n)));
      if (!opts.hold) c.close();
    },
  });
  const res = new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  return { res, push: (e: SseEvent) => controller.enqueue(enc.encode(encodeSse(e))), close: () => controller.close() };
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export const DONE = (
  conversation_id = "11111111-1111-4111-8111-111111111111",
  message_id = "22222222-2222-4222-8222-222222222222",
): SseEvent => ({ type: "done", message_id, conversation_id });
