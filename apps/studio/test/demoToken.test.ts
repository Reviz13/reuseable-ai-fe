import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/demo-token/route";

const req = (role?: string) =>
  new Request("http://studio.test/api/demo-token" + (role ? `?role=${role}` : ""));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("GET /api/demo-token", () => {
  it("posts the role to mock-pos and passes the token through", async () => {
    vi.stubEnv("MOCK_POS_URL", "http://pos.test:4100/");
    const fetchMock = vi.fn().mockResolvedValue(new Response("a.b.c", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(req("owner"));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("a.b.c");
    expect(res.headers.get("content-type")).toContain("text/plain");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://pos.test:4100/token");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ role: "owner" });
  });

  it("rejects unknown or missing roles with 400 and never calls upstream", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await GET(req("hacker"))).status).toBe(400);
    expect((await GET(req())).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 404 in production unless DEMO_ENABLED=1", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const fetchMock = vi.fn().mockResolvedValue(new Response("a.b.c"));
    vi.stubGlobal("fetch", fetchMock);

    expect((await GET(req("owner"))).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubEnv("DEMO_ENABLED", "1");
    expect((await GET(req("owner"))).status).toBe(200);
  });

  it("returns 502 when mock-pos is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect((await GET(req("cashier"))).status).toBe(502);
  });
});
