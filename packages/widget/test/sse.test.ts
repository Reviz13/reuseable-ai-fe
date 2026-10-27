import { describe, expect, it } from "vitest";
import { parseSse } from "../src/sse";

function streamOf(chunks: (string | Uint8Array)[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(typeof ch === "string" ? enc.encode(ch) : ch);
      c.close();
    },
  });
}
async function collect(s: ReadableStream<Uint8Array>) {
  const out = [];
  for await (const e of parseSse(s)) out.push(e);
  return out;
}

describe("parseSse", () => {
  it("yields one event for input split across chunks", async () => {
    const out = await collect(streamOf(["event: tok", 'en\ndata: {"type":"token","te', 'xt":"hai"}\n\n']));
    expect(out).toEqual([{ type: "token", text: "hai" }]);
  });
  it("yields multiple events from one chunk and handles CRLF", async () => {
    const out = await collect(
      streamOf(['event: state\r\ndata: {"type":"state","avatar":"thinking"}\r\n\r\nevent: token\ndata: {"type":"token","text":"a"}\n\n']),
    );
    expect(out.map((e) => e.type)).toEqual(["state", "token"]);
  });
  it("skips comments and invalid frames", async () => {
    const out = await collect(
      streamOf([": ping\n\n", "data: not json\n\n", 'data: {"type":"state","avatar":"bogus"}\n\n', 'data: {"type":"token","text":"ok"}\n\n']),
    );
    expect(out).toEqual([{ type: "token", text: "ok" }]);
  });
  it("does not split a multibyte char across chunks", async () => {
    const bytes = new TextEncoder().encode('data: {"type":"token","text":"é"}\n\n');
    const i = bytes.indexOf(0xc3) + 1;
    expect(await collect(streamOf([bytes.slice(0, i), bytes.slice(i)]))).toEqual([{ type: "token", text: "é" }]);
  });
});
