import DOMPurify from "dompurify";
import { marked } from "marked";

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

/** Markdown to sanitised HTML: scripts, handlers, javascript: URLs and images never survive. */
export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false, gfm: true, breaks: true }) as string;
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ["img", "picture", "source", "svg", "math", "style", "form", "input", "iframe"],
    FORBID_ATTR: ["style", "srcset"],
  });
}
