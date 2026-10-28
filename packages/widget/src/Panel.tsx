import type { AvatarState } from "@ai/contracts";
import { useEffect, useRef } from "preact/hooks";
import { Avatar } from "./Avatar";
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
  frames: Record<AvatarState, string>;
  avatar: AvatarState;
  reducedMotion: boolean;
  /** One line under the name: ready, thinking, checking data or typing. */
  status: string;
  suggestions: readonly string[];
  onSend(text: string): void;
  onClose(): void;
  onFeedback(msg: Msg, rating: 1 | -1): void;
}

export function Panel(props: PanelProps) {
  const { name, labels, messages, streaming, onSend, onClose, onFeedback } = props;
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
        <div class="head-avatar" data-state={props.avatar}>
          <Avatar frames={props.frames} state={props.avatar} reducedMotion={props.reducedMotion} name={name} decorative />
        </div>
        <div class="head-text">
          <span class="title">{name}</span>
          <span class="status" data-busy={streaming ? "" : undefined}>
            {props.status}
          </span>
        </div>
        <button type="button" class="close" aria-label={labels.close} onClick={onClose}>
          ×
        </button>
      </header>
      <div class="log" ref={log} aria-live="polite">
        {messages.length === 0 && (
          <div class="welcome">
            <p>{labels.greeting(name)}</p>
            <div class="suggestions">
              {props.suggestions.map((s) => (
                <button key={s} type="button" class="suggest" disabled={streaming} onClick={() => onSend(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => {
          const waiting = m.role === "assistant" && streaming && !m.text && !m.error && i === messages.length - 1;
          const bubble = (
            <div key={m.id} class={`msg ${m.role}`}>
              {waiting && (
                <span class="typing" aria-label={labels.typing}>
                  <i />
                  <i />
                  <i />
                </span>
              )}
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
          );
          return m.role === "assistant" ? (
            <div key={m.id} class="row">
              <img class="mini" src={props.frames.idle} alt="" draggable={false} />
              {bubble}
            </div>
          ) : (
            bubble
          );
        })}
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
