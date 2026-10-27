import { useEffect, useRef } from "preact/hooks";
import type { Labels } from "./copy";
import { MAX_MESSAGE_CHARS } from "./copy";
import { renderMarkdown } from "./markdown";

export interface Citation {
  document_id: string;
  title: string;
  heading?: string;
}

export interface Msg {
  id: number;
  role: "user" | "assistant";
  text: string;
  citations: Citation[];
  /** Set once the server sent `done`; feedback is only offered for these. */
  messageId?: string;
  rating?: 1 | -1;
  error?: string;
}

export interface PanelProps {
  name: string;
  labels: Labels;
  messages: Msg[];
  streaming: boolean;
  onSend(text: string): void;
  onClose(): void;
  onFeedback(msg: Msg, rating: 1 | -1): void;
}

export function Panel({ name, labels, messages, streaming, onSend, onClose, onFeedback }: PanelProps) {
  const input = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLDivElement>(null);

  // Focus the input on open and again whenever a stream finishes.
  useEffect(() => {
    if (!streaming) input.current?.focus();
  }, [streaming]);
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [messages]);

  const submit = (e: Event) => {
    e.preventDefault();
    const el = input.current;
    if (!el || streaming) return;
    const text = el.value.trim();
    if (!text) return;
    el.value = "";
    onSend(text);
  };

  return (
    <div class="panel" role="dialog" aria-label={name}>
      <header class="head">
        <span class="title">{name}</span>
        <button type="button" class="close" aria-label={labels.close} onClick={onClose}>
          ×
        </button>
      </header>
      <div class="log" ref={log} aria-live="polite">
        {messages.map((m) => (
          <div key={m.id} class={`msg ${m.role}`}>
            {m.role === "user" ? (
              <p class="plain">{m.text}</p>
            ) : (
              m.text && <div class="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }} />
            )}
            {m.error && (
              <p class="err" role="alert">
                {m.error}
              </p>
            )}
            {m.citations.length > 0 && (
              <div class="chips">
                {m.citations.map((c) => (
                  <span key={c.document_id + (c.heading ?? "")} class="chip" title={c.heading || undefined}>
                    {c.title}
                  </span>
                ))}
              </div>
            )}
            {m.role === "assistant" && m.messageId && (
              <div class="feedback">
                <button
                  type="button"
                  class="fb"
                  aria-label={labels.helpful}
                  aria-pressed={m.rating === 1}
                  disabled={m.rating !== undefined}
                  onClick={() => onFeedback(m, 1)}
                >
                  {"\u{1F44D}"}
                </button>
                <button
                  type="button"
                  class="fb"
                  aria-label={labels.unhelpful}
                  aria-pressed={m.rating === -1}
                  disabled={m.rating !== undefined}
                  onClick={() => onFeedback(m, -1)}
                >
                  {"\u{1F44E}"}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      <form class="form" onSubmit={submit}>
        <input
          ref={input}
          type="text"
          maxLength={MAX_MESSAGE_CHARS}
          placeholder={labels.placeholder}
          aria-label={labels.placeholder}
          disabled={streaming}
          autocomplete="off"
        />
        <button type="submit" class="send" disabled={streaming}>
          {labels.send}
        </button>
      </form>
    </div>
  );
}
