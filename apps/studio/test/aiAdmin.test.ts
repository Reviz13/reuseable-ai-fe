import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));
const { redirect, getSession } = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  getSession: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect, notFound: vi.fn() }));
vi.mock("../lib/supabase", () => ({
  createServerSupabase: async () => ({ auth: { getSession } }),
}));

import { aiAdmin } from "../lib/aiAdmin";
import { AdminApiError, ForbiddenError } from "../lib/errors";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("aiAdmin", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    redirect.mockClear();
    getSession.mockReset();
    getSession.mockResolvedValue({ data: { session: { access_token: "tok-123" } } });
    vi.stubGlobal("fetch", fetchMock);
    process.env.AI_SERVICE_URL = "http://ai.test";
  });

  it("sends the bearer token to AI_SERVICE_URL + path", async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true }));
    await aiAdmin("/admin/pos/documents");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://ai.test/admin/pos/documents");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok-123");
  });

  it("returns schema-validated data", async () => {
    fetchMock.mockResolvedValue(json(200, { n: 3 }));
    await expect(aiAdmin("/x", { schema: z.object({ n: z.number() }) })).resolves.toEqual({ n: 3 });
  });

  it("throws when the response does not match the schema", async () => {
    fetchMock.mockResolvedValue(json(200, { n: "nope" }));
    await expect(aiAdmin("/x", { schema: z.object({ n: z.number() }) })).rejects.toThrow();
  });

  it("redirects to /login on 401", async () => {
    fetchMock.mockResolvedValue(json(401, { error: "unauthorized" }));
    await expect(aiAdmin("/x")).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("redirects to /login without calling ai-service when there is no session", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    await expect(aiAdmin("/x")).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws ForbiddenError on 403", async () => {
    fetchMock.mockResolvedValue(json(403, { error: "forbidden" }));
    await expect(aiAdmin("/x")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws AdminApiError with status and body on other failures", async () => {
    const body = { error: "bad_request", issues: [{ path: ["name"], code: "too_small" }] };
    fetchMock.mockResolvedValue(json(400, body));
    const err = (await aiAdmin("/x").catch((e) => e)) as AdminApiError;
    expect(err).toBeInstanceOf(AdminApiError);
    expect(err.status).toBe(400);
    expect(err.body).toEqual(body);
  });

  it("does not force a JSON content-type on FormData bodies", async () => {
    fetchMock.mockResolvedValue(json(202, { status: "processing" }));
    const fd = new FormData();
    fd.set("file", new Blob(["hi"]), "a.txt");
    await aiAdmin("/admin/pos/documents", { method: "POST", body: fd });
    const init = fetchMock.mock.calls[0]![1];
    expect(new Headers(init.headers).get("content-type")).toBeNull();
    expect(init.body).toBe(fd);
  });
});
