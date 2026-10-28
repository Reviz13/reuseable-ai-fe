import { render } from "preact";
import { isPosition, loadPosition, savePosition, type Position } from "./position";
import css from "./styles.css?inline";
import { Widget } from "./Widget";

type Send = (text: string) => void;

/** `suggestions="A | B"`: pipe separated quick questions; null keeps the built-in ones. */
function parseSuggestions(attr: string | null): string[] | null {
  if (attr === null) return null;
  return attr.split("|").map((s) => s.trim()).filter(Boolean);
}

export class AiAssistantElement extends HTMLElement {
  static observedAttributes = ["app", "api", "position", "open", "lang", "suggestions"];

  /**
   * Host-provided token source. Held in memory only; never persisted.
   * `declare` (no class field): hosts often set it before the script loads (e.g. a React ref on the
   * not-yet-upgraded element). A class field would redefine it as undefined on upgrade. Found by E2E.
   */
  declare getToken?: () => Promise<string>;

  private opened = false;
  private connected = false;
  private dragged: Position | null = null;
  private sender: Send | null = null;
  private pendingAsk: string | null = null;
  private readonly mount: HTMLDivElement;

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = css;
    this.mount = document.createElement("div");
    shadow.append(style, this.mount);
  }

  connectedCallback(): void {
    this.connected = true;
    this.opened = this.hasAttribute("open");
    this.draw();
  }

  disconnectedCallback(): void {
    this.connected = false;
    render(null, this.mount);
  }

  attributeChangedCallback(name: string, oldValue: string | null, value: string | null): void {
    if (oldValue === value) return;
    if (name === "open") {
      if (this.connected) this.setOpen(value !== null);
      return;
    }
    if (name === "app") this.dragged = null;
    if (this.connected) this.draw();
  }

  open(): void {
    this.setOpen(true);
  }

  close(): void {
    this.setOpen(false);
  }

  ask(text: string): void {
    this.setOpen(true);
    if (this.sender) this.sender(text);
    else this.pendingAsk = text;
  }

  private setOpen(value: boolean): void {
    if (value === this.opened) return;
    this.opened = value;
    this.toggleAttribute("open", value);
    this.emit(value ? "ai-open" : "ai-close", undefined);
    this.draw();
  }

  private emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  private draw(): void {
    const app = this.getAttribute("app");
    const api = this.getAttribute("api");
    if (!app || !api) {
      render(null, this.mount);
      return;
    }
    const attr = this.getAttribute("position");
    const corner = this.dragged ?? loadPosition(app) ?? (isPosition(attr) ? attr : "bottom-right");
    render(
      <Widget
        key={`${app}|${api}`}
        app={app}
        api={api}
        lang={this.getAttribute("lang")}
        suggestions={parseSuggestions(this.getAttribute("suggestions"))}
        open={this.opened}
        corner={corner}
        getToken={() => (this.getToken ? this.getToken() : Promise.reject(new Error("getToken is not set")))}
        onOpenChange={(v) => this.setOpen(v)}
        onCorner={(p) => {
          this.dragged = p;
          savePosition(app, p);
          this.draw();
        }}
        onMessage={(d) => this.emit("ai-message", d)}
        onError={(d) => this.emit("ai-error", d)}
        bind={(send) => {
          this.sender = send;
          if (send && this.pendingAsk !== null) {
            const t = this.pendingAsk;
            this.pendingAsk = null;
            send(t);
          }
        }}
      />,
      this.mount,
    );
  }
}

if (!customElements.get("ai-assistant")) customElements.define("ai-assistant", AiAssistantElement);
