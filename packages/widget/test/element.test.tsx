import { waitFor } from "@testing-library/preact";
import type { SseEvent } from "@ai/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../src/element";
import { DONE, jsonResponse, PUBLIC, sseResponse } from "./helpers";

type El = HTMLElement & { getToken?: () => Promise<string>; open(): void; close(): void; ask(t: string): void };

const SESSION = "Sesi berakhir, silakan muat ulang.";
const CHAT_URL = "http://api.test/v1/chat";

let chatResponses: Array<(init: RequestInit) => Response | Promise<Response>>;
let fetchMock: ReturnType<typeof vi.fn>;

function chatCalls() {
  return fetchMock.mock.calls.filter((c) => c[0] === CHAT_URL);
}
function chatBody(i: number) {
  return JSON.parse((chatCalls()[i]![1] as { body: string }).body);
}

beforeEach(() => {
  chatResponses = [];
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith("/public")) return jsonResponse(200, PUBLIC);
    if (url === CHAT_URL) {
      const next = chatResponses.shift();
      if (!next) throw new Error("unexpected chat call");
      return next(init);
    }
    if (url.endsWith("/v1/feedback")) return jsonResponse(200, { ok: true });
    throw new Error("unexpected " + url);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mount(attrs: Record<string, string> = {}, getToken: (() => Promise<string>) | null = async () => "tok"): El {
  const el = document.createElement("ai-assistant") as El;
  el.setAttribute("app", "pos");
  el.setAttribute("api", "http://api.test");
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (getToken) el.getToken = getToken;
  document.body.appendChild(el);
  return el;
}
const q = <T extends Element = HTMLElement>(el: El, sel: string) => el.shadowRoot!.querySelector(sel) as T | null;
const qa = (el: El, sel: string) => [...el.shadowRoot!.querySelectorAll(sel)] as HTMLElement[];
const list = (el: El) => q(el, '[aria-live="polite"]')!;

async function send(el: El, text: string) {
  const input = q<HTMLInputElement>(el, "input")!;
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  q(el, "form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}
async function openPanel(el: El) {
  el.open();
  await waitFor(() => expect(q(el, '[role="dialog"]')).not.toBeNull());
}
const events = (...types: string[]): SseEvent[] => types.map((t) => ({ type: "state", avatar: t }) as SseEvent);

describe("registration and shadow DOM", () => {
  it("defines ai-assistant exactly once (re-import is a no-op)", async () => {
    expect(customElements.get("ai-assistant")).toBeDefined();
    vi.resetModules();
    await expect(import("../src/element")).resolves.toBeDefined();
  });

  it("mounts even when localStorage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const el = mount();
    await waitFor(() => expect(q(el, "button")).not.toBeNull());
  });

  it("is isolated from host page styles", async () => {
    const style = document.createElement("style");
    style.textContent = "button { color: red !important; }";
    document.head.appendChild(style);
    const hostButton = document.createElement("button");
    document.body.appendChild(hostButton);
    const el = mount();
    await waitFor(() => expect(q(el, "button")).not.toBeNull());
    expect(getComputedStyle(hostButton).color).toBe("red");
    expect(getComputedStyle(q(el, "button")!).color).not.toBe("red");
  });

  it("inlines its own styles in the shadow root and uses host CSS variables", async () => {
    const el = mount();
    await waitFor(() => expect(q(el, "style")).not.toBeNull());
    const css = q(el, "style")!.textContent!;
    for (const v of ["--ai-inset-x", "--ai-inset-y", "--ai-z", "--ai-accent"]) expect(css).toContain(v);
  });
});

describe("accessibility and open/close", () => {
  it("launcher button is labelled with the assistant name; panel is a labelled dialog with a polite log", async () => {
    const el = mount();
    await waitFor(() => expect(q(el, "button.launcher")!.getAttribute("aria-label")).toBe("Kopi Bot"));
    expect(q(el, '[role="dialog"]')).toBeNull();
    await openPanel(el);
    expect(q(el, '[role="dialog"]')!.getAttribute("aria-label")).toBe("Kopi Bot");
    expect(list(el)).not.toBeNull();
  });

  it("emits ai-open/ai-close (bubbles, composed), toggles on launcher click, closes on Escape", async () => {
    const el = mount();
    const seen: Event[] = [];
    document.addEventListener("ai-open", (e) => seen.push(e));
    document.addEventListener("ai-close", (e) => seen.push(e));
    await waitFor(() => expect(q(el, "button.launcher")).not.toBeNull());
    q(el, "button.launcher")!.click();
    await waitFor(() => expect(q(el, '[role="dialog"]')).not.toBeNull());
    expect(seen.map((e) => e.type)).toEqual(["ai-open"]);
    expect(seen[0]!.bubbles && seen[0]!.composed).toBe(true);
    q(el, '[role="dialog"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await waitFor(() => expect(q(el, '[role="dialog"]')).toBeNull());
    expect(seen.map((e) => e.type)).toEqual(["ai-open", "ai-close"]);
  });

  it("focuses the input when the panel opens and honours the open attribute", async () => {
    const el = mount({ open: "" });
    await waitFor(() => expect(q(el, '[role="dialog"]')).not.toBeNull());
    await waitFor(() => expect(el.shadowRoot!.activeElement).toBe(q(el, "input")));
    el.removeAttribute("open");
    await waitFor(() => expect(q(el, '[role="dialog"]')).toBeNull());
  });

  it("applies position attribute and a stored corner overrides it", async () => {
    const el = mount({ position: "top-left" });
    await waitFor(() => expect(q(el, ".root.top-left")).not.toBeNull());
    document.body.innerHTML = "";
    localStorage.setItem("ai-assistant:pos:position", "bottom-left");
    const el2 = mount({ position: "top-left" });
    await waitFor(() => expect(q(el2, ".root.bottom-left")).not.toBeNull());
    localStorage.clear();
  });
});

describe("chat flow", () => {
  it("concatenates tokens, shows citation chips and feedback only after done, emits ai-message", async () => {
    const s = sseResponse(
      [
        ...events("thinking", "talking"),
        { type: "token", text: "Halo " },
        { type: "token", text: "**dunia**" },
        { type: "citation", document_id: "d1", title: "Panduan Kasir", heading: "Buka shift", version: 1 },
        { type: "citation", document_id: "d2", title: "Tanpa Heading", version: 1 },
        ...events("happy"),
      ],
      { hold: true, split: 7 },
    );
    chatResponses.push(() => s.res);
    const el = mount();
    const msgs: CustomEvent[] = [];
    el.addEventListener("ai-message", (e) => msgs.push(e as CustomEvent));
    await openPanel(el);
    await send(el, "  Halo?  ");
    await waitFor(() => expect(list(el).textContent).toContain("Halo dunia"));
    expect(list(el).querySelector("strong")!.textContent).toBe("dunia");
    expect(qa(el, ".chip").map((c) => c.textContent)).toEqual(["Panduan Kasir", "Tanpa Heading"]);
    expect(qa(el, ".chip")[0]!.getAttribute("title")).toBe("Buka shift");
    expect(qa(el, ".chip")[1]!.hasAttribute("title")).toBe(false);
    expect(qa(el, "button.fb")).toHaveLength(0);
    expect(chatBody(0)).toEqual({ app: "pos", message: "Halo?" });
    s.push(DONE());
    s.close();
    await waitFor(() => expect(qa(el, "button.fb")).toHaveLength(2));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.detail).toEqual({ message_id: "22222222-2222-4222-8222-222222222222", text: "Halo **dunia**" });
    expect(msgs[0]!.bubbles && msgs[0]!.composed).toBe(true);
  });

  it("drives the launcher avatar from server state events", async () => {
    const s = sseResponse(events("thinking"), { hold: true });
    chatResponses.push(() => s.res);
    const el = mount();
    await openPanel(el);
    await send(el, "hi");
    await waitFor(() => expect(q(el, ".launcher img[data-active]")!.getAttribute("data-state")).toBe("thinking"));
    s.push({ type: "state", avatar: "sad" });
    await waitFor(() => expect(q(el, ".launcher img[data-active]")!.getAttribute("data-state")).toBe("sad"));
    s.close();
  });

  it("reuses conversation_id on the second message", async () => {
    chatResponses.push(() => sseResponse([DONE("aaaaaaaa-1111-4111-8111-111111111111")]).res);
    chatResponses.push(() => sseResponse([DONE("aaaaaaaa-1111-4111-8111-111111111111", "33333333-3333-4333-8333-333333333333")]).res);
    const el = mount();
    await openPanel(el);
    await send(el, "satu");
    await waitFor(() => expect(qa(el, "button.fb")).toHaveLength(2));
    await send(el, "dua");
    await waitFor(() => expect(chatCalls()).toHaveLength(2));
    expect(chatBody(0).conversation_id).toBeUndefined();
    expect(chatBody(1).conversation_id).toBe("aaaaaaaa-1111-4111-8111-111111111111");
  });

  it("resets the conversation when app or api changes", async () => {
    chatResponses.push(() => sseResponse([DONE("aaaaaaaa-1111-4111-8111-111111111111")]).res);
    chatResponses.push(() => sseResponse([DONE()]).res);
    const el = mount();
    await openPanel(el);
    await send(el, "satu");
    await waitFor(() => expect(qa(el, "button.fb")).toHaveLength(2));
    el.setAttribute("app", "erp");
    await waitFor(() => expect(qa(el, ".msg")).toHaveLength(0));
    await send(el, "dua");
    await waitFor(() => expect(chatCalls()).toHaveLength(2));
    expect(chatBody(1).conversation_id).toBeUndefined();
    expect(chatBody(1).app).toBe("erp");
  });

  it("refreshes the token on 401 and renders the answer (getToken called twice)", async () => {
    const getToken = vi.fn().mockResolvedValueOnce("t1").mockResolvedValueOnce("t2");
    chatResponses.push(() => jsonResponse(401, { error: "unauthorized" }));
    chatResponses.push(() => sseResponse([{ type: "token", text: "Berhasil" }, DONE()]).res);
    const el = mount({}, getToken);
    await openPanel(el);
    await send(el, "hi");
    await waitFor(() => expect(list(el).textContent).toContain("Berhasil"));
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it("shows the SESSION copy and emits ai-error after a second 401", async () => {
    chatResponses.push(() => jsonResponse(401, { error: "unauthorized" }));
    chatResponses.push(() => jsonResponse(401, { error: "unauthorized" }));
    const el = mount();
    const errs: CustomEvent[] = [];
    el.addEventListener("ai-error", (e) => errs.push(e as CustomEvent));
    await openPanel(el);
    await send(el, "hi");
    await waitFor(() => expect(list(el).textContent).toContain(SESSION));
    expect(errs[0]!.detail).toEqual({ code: "UNAUTHORIZED" });
  });

  it("emits ai-error UNAUTHORIZED with SESSION copy when getToken is missing", async () => {
    const el = mount({}, null);
    const errs: CustomEvent[] = [];
    el.addEventListener("ai-error", (e) => errs.push(e as CustomEvent));
    await openPanel(el);
    await send(el, "hi");
    await waitFor(() => expect(list(el).textContent).toContain(SESSION));
    expect(errs[0]!.detail).toEqual({ code: "UNAUTHORIZED" });
    expect(chatCalls()).toHaveLength(0);
  });

  it("shows the server message on 429", async () => {
    chatResponses.push(() => jsonResponse(429, { error: "rate_limited", message: "Terlalu banyak pertanyaan, tunggu sebentar ya." }));
    const el = mount();
    const errs: CustomEvent[] = [];
    el.addEventListener("ai-error", (e) => errs.push(e as CustomEvent));
    await openPanel(el);
    await send(el, "hi");
    await waitFor(() => expect(list(el).textContent).toContain("Terlalu banyak pertanyaan, tunggu sebentar ya."));
    expect(errs[0]!.detail).toEqual({ code: "RATE_LIMITED" });
  });

  it("shows the connection copy and a sad avatar on network errors", async () => {
    chatResponses.push(() => {
      throw new TypeError("Failed to fetch");
    });
    const el = mount();
    await openPanel(el);
    await send(el, "hi");
    await waitFor(() => expect(list(el).textContent).toContain("Koneksi bermasalah, coba lagi."));
    expect(q(el, ".launcher img[data-active]")!.getAttribute("data-state")).toBe("sad");
  });

  it("renders SSE error events and marks the avatar sad", async () => {
    chatResponses.push(
      () => sseResponse([{ type: "error", code: "LLM_UNAVAILABLE", message: "LLM down" }]).res,
    );
    const el = mount();
    await openPanel(el);
    await send(el, "hi");
    await waitFor(() => expect(list(el).textContent).toContain("LLM down"));
  });

  it("disables input and send while streaming, and re-enables after done", async () => {
    const s = sseResponse([{ type: "token", text: "x" }], { hold: true });
    chatResponses.push(() => s.res);
    const el = mount();
    await openPanel(el);
    await send(el, "hi");
    await waitFor(() => expect(q<HTMLInputElement>(el, "input")!.disabled).toBe(true));
    expect(q<HTMLButtonElement>(el, "button.send")!.disabled).toBe(true);
    expect(q<HTMLInputElement>(el, "input")!.getAttribute("maxlength")).toBe("2000");
    s.push(DONE());
    s.close();
    await waitFor(() => expect(q<HTMLInputElement>(el, "input")!.disabled).toBe(false));
  });

  it("aborts the in-flight stream when the panel closes", async () => {
    let signal: AbortSignal | null | undefined;
    const s = sseResponse([{ type: "token", text: "partial" }], { hold: true });
    chatResponses.push((init) => {
      signal = init.signal;
      return s.res;
    });
    const el = mount();
    await openPanel(el);
    await send(el, "hi");
    await waitFor(() => expect(signal).toBeDefined());
    q(el, "button.close")!.click();
    await waitFor(() => expect(signal!.aborted).toBe(true));
    await waitFor(() => expect(q(el, '[role="dialog"]')).toBeNull());
  });

  it("ask() opens the panel and sends the text", async () => {
    chatResponses.push(() => sseResponse([{ type: "token", text: "Jawab" }, DONE()]).res);
    const el = mount();
    el.ask("Profit minggu ini?");
    await waitFor(() => expect(list(el).textContent).toContain("Jawab"));
    expect(chatBody(0).message).toBe("Profit minggu ini?");
    expect(list(el).textContent).toContain("Profit minggu ini?");
  });

  it("posts feedback for an answered message", async () => {
    chatResponses.push(() => sseResponse([{ type: "token", text: "ok" }, DONE()]).res);
    const el = mount();
    await openPanel(el);
    await send(el, "hi");
    await waitFor(() => expect(qa(el, "button.fb")).toHaveLength(2));
    qa(el, "button.fb")[1]!.click();
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => (c[0] as string).endsWith("/v1/feedback"))).toBe(true));
    const call = fetchMock.mock.calls.find((c) => (c[0] as string).endsWith("/v1/feedback"))!;
    expect(JSON.parse((call[1] as { body: string }).body)).toEqual({
      app: "pos",
      message_id: "22222222-2222-4222-8222-222222222222",
      rating: -1,
    });
  });
});
