import { SseEventSchema, type SseEvent } from "@ai/contracts";

type Source = ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>;

async function* chunks(src: Source): AsyncGenerator<Uint8Array> {
  if ("getReader" in src) {
    const reader = src.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  } else {
    yield* src;
  }
}

function frameToEvent(frame: string): SseEvent | null {
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("data:")) data.push(line.slice(line[5] === " " ? 6 : 5));
  }
  if (!data.length) return null;
  try {
    const parsed = SseEventSchema.safeParse(JSON.parse(data.join("\n")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Parses a `text/event-stream` body into validated events. Comment and invalid frames are skipped. */
export async function* parseSse(stream: Source): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of chunks(stream)) {
    buf += decoder.decode(chunk, { stream: true }).replace(/\r\n?/g, "\n");
    let i: number;
    while ((i = buf.indexOf("\n\n")) !== -1) {
      const ev = frameToEvent(buf.slice(0, i));
      buf = buf.slice(i + 2);
      if (ev) yield ev;
    }
  }
}
