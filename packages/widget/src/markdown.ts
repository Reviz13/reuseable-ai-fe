import DOMPurify from "dompurify";
import { Marked } from "marked";

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// M1: raw HTML in model output is shown as text, never rendered, so tags cannot rejoin a figure
// ("9<span></span>.999.000") after the server's guardrail checked it.
const md = new Marked({ async: false, gfm: true, breaks: true, renderer: { html: ({ text }) => escapeHtml(text) } });

/** Markdown to sanitised HTML: raw HTML, scripts, handlers, javascript: URLs and images never survive. */
export function renderMarkdown(text: string): string {
  const html = md.parse(text) as string;
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ["img", "picture", "source", "svg", "math", "style", "form", "input", "iframe"],
    FORBID_ATTR: ["style", "srcset"],
  });
}
