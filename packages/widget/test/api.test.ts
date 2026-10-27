import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../src/api";
import { DONE, jsonResponse, sseResponse } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

const make = (getToken: () => Promise<string>) => createApiClient({ api: "http://api.test/", app: "pos", getToken });
const sig = () => new AbortController().signal;
const hdr = (call: unknown[], k: string) => ((call[1] as { headers: Record<string, string> }).headers)[k];

describe("api client", () => {
  it("retries once on 401 with a refreshed token", async () => {
    const getToken = vi.fn().mockResolvedValueOnce("t1").mockResolvedValueOnce("t2");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: "unauthorized" }))
      .mockResolvedValueOnce(sseResponse([DONE()]).res);
    vi.stubGlobal("fetch", fetchMock);
    const events: string[] = [];
    await make(getToken).chat({ message: "hi" }, (e) => events.push(e.type), sig());
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(events).toEqual(["done"]);
    expect(fetchMock.mock.calls[0]![0]).toBe("http://api.test/v1/chat");
    expect(hdr(fetchMock.mock.calls[0]!, "authorization")).toBe("Bearer t1");
    expect(hdr(fetchMock.mock.calls[1]!, "authorization")).toBe("Bearer t2");
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)).toEqual({ app: "pos", message: "hi" });
  });

  it("throws UNAUTHORIZED after a second 401", async () => {
    const getToken = vi.fn().mockResolvedValue("t");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => jsonResponse(401, { error: "unauthorized" })));
    await expect(make(getToken).chat({ message: "hi" }, () => {}, sig())).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it("caches the token in memory across calls", async () => {
    const getToken = vi.fn().mockResolvedValue("t");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => sseResponse([DONE()]).res));
    const c = make(getToken);
    await c.chat({ message: "a" }, () => {}, sig());
    await c.chat({ message: "b" }, () => {}, sig());
    expect(getToken).toHaveBeenCalledTimes(1);
  });

  it("maps 429 and 400 to coded errors carrying the server message", async () => {
    const getToken = vi.fn().mockResolvedValue("t");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(429, { error: "rate_limited", message: "pelan2" })));
    await expect(make(getToken).chat({ message: "a" }, () => {}, sig())).rejects.toMatchObject({
      code: "RATE_LIMITED",
      message: "pelan2",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(400, { error: "bad_request", message: "terlalu panjang" })));
    await expect(make(getToken).chat({ message: "a" }, () => {}, sig())).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "terlalu panjang",
    });
  });

  it("maps fetch failure to NETWORK", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("failed")));
    await expect(make(async () => "t").chat({ message: "a" }, () => {}, sig())).rejects.toMatchObject({ code: "NETWORK" });
  });

  it("posts feedback with bearer auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await make(async () => "t").feedback({ message_id: "m", rating: 1 });
    expect(fetchMock.mock.calls[0]![0]).toBe("http://api.test/v1/feedback");
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)).toEqual({ app: "pos", message_id: "m", rating: 1 });
  });

  it("fetches the public assistant without auth", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { app: "pos", name: "N", theme: { accent: "#fff" }, avatar_frames: {} }));
    vi.stubGlobal("fetch", fetchMock);
    const getToken = vi.fn();
    const a = await make(getToken).publicAssistant();
    expect(a?.name).toBe("N");
    expect(fetchMock.mock.calls[0]![0]).toBe("http://api.test/v1/assistants/pos/public");
    expect(getToken).not.toHaveBeenCalled();
  });
});
