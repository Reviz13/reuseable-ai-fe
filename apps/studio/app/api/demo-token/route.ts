// Demo only: issues a mock-POS JWT to anyone who asks. Disabled in production unless DEMO_ENABLED=1.
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === "production" && process.env.DEMO_ENABLED !== "1") {
    return new Response("Not found", { status: 404 });
  }
  const role = new URL(request.url).searchParams.get("role");
  if (role !== "owner" && role !== "cashier") {
    return new Response("role must be owner or cashier", { status: 400 });
  }
  const base = (process.env.MOCK_POS_URL ?? "http://localhost:4100").replace(/\/+$/, "");
  let upstream: Response;
  try {
    upstream = await fetch(`${base}/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role }),
      cache: "no-store",
    });
  } catch {
    return new Response("mock POS unreachable", { status: 502 });
  }
  if (!upstream.ok) return new Response("mock POS refused the token request", { status: 502 });
  return new Response(await upstream.text(), {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
