// DOMPurify needs a spec-complete DOM; happy-dom's tree walking does not honour its allow-list, so this
// file runs under jsdom. (Real browsers are unaffected.)
// @vitest-environment jsdom
import { waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../src/element";
import { renderMarkdown } from "../src/markdown";
import { DONE, jsonResponse, PUBLIC, sseResponse } from "./helpers";

const EVIL =
  'hello <script>window.__pwned=1</script><img src=x onerror="window.__pwned=1"> ![pic](http://e/x.png) ' +
  '[bad](javascript:alert(1)) [ok](https://example.com) <a href="https://e.com" onclick="window.__pwned=1">c</a>';

describe("renderMarkdown", () => {
  it("strips scripts, handlers, javascript: urls and images; hardens links", () => {
    const host = document.createElement("div");
    host.innerHTML = renderMarkdown(EVIL);
    expect(host.querySelector("script")).toBeNull();
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector("[onerror],[onclick]")).toBeNull();
    for (const a of host.querySelectorAll("a")) {
      expect(a.getAttribute("href") ?? "").not.toMatch(/^javascript:/i);
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    }
    expect(host.querySelectorAll("a").length).toBeGreaterThan(0);
  });
  it("renders basic markdown", () => {
    expect(renderMarkdown("**a**")).toContain("<strong>a</strong>");
  });
  it("raw HTML in model output renders as text, inline and as a block (M1)", () => {
    const host = document.createElement("div");
    host.innerHTML = renderMarkdown("Profit 9<span></span>.999.000 dan <b>tebal</b>");
    expect(host.querySelector("span")).toBeNull();
    expect(host.querySelector("b")).toBeNull();
    expect(host.textContent).toContain("9<span></span>.999.000");
    host.innerHTML = renderMarkdown("<div>\nblok <i>x</i>\n</div>");
    expect(host.querySelector("div")).toBeNull();
    expect(host.textContent).toContain("<div>");
  });
});

describe("sanitization end to end", () => {
  let chat: Response;
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (url.endsWith("/public") ? jsonResponse(200, PUBLIC) : chat)),
    );
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("a script or onerror in a streamed token never reaches the DOM", async () => {
    chat = sseResponse([{ type: "token", text: EVIL }, DONE()]).res;
    const el = document.createElement("ai-assistant") as HTMLElement & { getToken: () => Promise<string>; open(): void };
    el.setAttribute("app", "pos");
    el.setAttribute("api", "http://api.test");
    el.getToken = async () => "tok";
    document.body.appendChild(el);
    el.open();
    const root = el.shadowRoot!;
    await waitFor(() => expect(root.querySelector("input")).not.toBeNull());
    const input = root.querySelector("input") as HTMLInputElement;
    input.value = "hi";
    root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await waitFor(() => expect(root.querySelector('[aria-live="polite"]')!.textContent).toContain("hello"));
    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector(".msg.assistant img")).toBeNull();
    expect(root.querySelector("[onerror]")).toBeNull();
    expect((globalThis as { __pwned?: number }).__pwned).toBeUndefined();
    for (const a of root.querySelectorAll(".msg.assistant a")) {
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
      expect(a.getAttribute("target")).toBe("_blank");
    }
  });
});
