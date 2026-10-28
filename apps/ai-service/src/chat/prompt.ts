import { copyFor } from "../copy.js";
import type { RetrievedChunk } from "../rag/retriever.js";

export interface PromptAssistant {
  persona_prompt: string;
  language: string;
}

function attr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Document text must not be able to close its own <doc> block or open a new one. */
function body(s: string): string {
  return s.replace(/<(\/?)doc/gi, "&lt;$1doc");
}

export function buildSystemPrompt(
  assistant: PromptAssistant,
  chunks: RetrievedChunk[],
  hasRelevantKnowledge: boolean,
  /** The user's local calendar date, so "30 September" resolves to the right year. */
  today?: { date: string; tz: string },
): string {
  const copy = copyFor(assistant.language);
  const parts: string[] = [assistant.persona_prompt.trim()];
  parts.push(
    [
      copy.rules.header,
      copy.rules.language(assistant.language),
      copy.rules.useTool,
      copy.rules.docsAreData,
      copy.rules.docsOnly,
      ...(today ? [copy.rules.today(today.date, today.tz)] : []),
    ].join("\n"),
  );
  if (!hasRelevantKnowledge) {
    parts.push(copy.rules.notFound(copy.NOT_FOUND));
  }
  if (chunks.length > 0) {
    parts.push(
      chunks
        .map(
          (c) =>
            `<doc id="${attr(c.document_id)}" title="${attr(c.title)}" heading="${attr(c.heading ?? "")}">${body(c.content)}</doc>`,
        )
        .join("\n"),
    );
  }
  return parts.join("\n\n");
}
