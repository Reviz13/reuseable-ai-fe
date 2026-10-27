import type { AvatarState, PublicAssistant } from "@ai/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ApiError, createApiClient, isAbort } from "./api";
import { Avatar } from "./Avatar";
import { GENERIC, labelsFor, MAX_MESSAGE_CHARS, NETWORK, NOT_FOUND_CONVERSATION, RATE_LIMITED, SESSION, TOO_LONG } from "./copy";
import { Panel, type Msg } from "./Panel";
import { nearestCorner, type Position } from "./position";

const STATES: AvatarState[] = ["idle", "thinking", "talking", "happy", "sad"];
const DRAG_THRESHOLD = 5;
const LAUNCHER_SIZE = 56;

export interface WidgetProps {
  app: string;
  api: string;
  lang: string | null;
  open: boolean;
  corner: Position;
  getToken: () => Promise<string>;
  onOpenChange(open: boolean): void;
  onCorner(p: Position): void;
  onMessage(detail: { message_id: string; text: string }): void;
  onError(detail: { code: string }): void;
  /** Registers `send` with the host element (for `ask`). Called with null on unmount. */
  bind(send: ((text: string) => void) | null): void;
}

function useReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => {
    try {
      return matchMedia(query).matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      const mq = matchMedia(query);
      const h = () => setReduced(mq.matches);
      mq.addEventListener("change", h);
      return () => mq.removeEventListener("change", h);
    } catch {
      return undefined;
    }
  }, []);
  return reduced;
}

function errorText(code: string, message: string): string {
  switch (code) {
    case "UNAUTHORIZED":
      return SESSION;
    case "RATE_LIMITED":
      return message || RATE_LIMITED;
    case "NETWORK":
      return NETWORK;
    case "NOT_FOUND":
      return NOT_FOUND_CONVERSATION;
    default:
      return message || GENERIC;
  }
}

const SAFE_COLOR = /^#[0-9a-f]{3,8}$/i;

export function Widget(props: WidgetProps) {
  const { app, api, open, corner } = props;
  const labels = labelsFor(props.lang);
  const reducedMotion = useReducedMotion();

  const [pub, setPub] = useState<PublicAssistant | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [avatar, setAvatar] = useState<AvatarState>("idle");
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);

  const conversationId = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const streamingRef = useRef(false);
  const nextId = useRef(1);
  const latest = useRef(props);
  latest.current = props;

  const client = useMemo(
    () => createApiClient({ api, app, getToken: () => latest.current.getToken() }),
    [api, app],
  );

  useEffect(() => {
    let live = true;
    void client.publicAssistant().then((p) => live && setPub(p));
    return () => {
      live = false;
    };
  }, [client]);

  const name = pub?.name ?? labels.defaultName;
  const frames = useMemo(() => {
    const base = api.replace(/\/+$/, "");
    return Object.fromEntries(
      STATES.map((s) => [s, pub?.avatar_frames[s] ?? `${base}/widget/v1/avatar/${s}.webp`]),
    ) as Record<AvatarState, string>;
  }, [pub, api]);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || streamingRef.current) return;
      const userId = nextId.current++;
      const asstId = nextId.current++;
      const patch = (fn: (m: Msg) => Msg) => setMessages((ms) => ms.map((m) => (m.id === asstId ? fn(m) : m)));
      const fail = (code: string, message: string) => {
        setAvatar("sad");
        patch((m) => ({ ...m, error: errorText(code, message) }));
        latest.current.onError({ code });
      };

      setMessages((ms) => [
        ...ms,
        { id: userId, role: "user", text, citations: [] },
        { id: asstId, role: "assistant", text: "", citations: [] },
      ]);
      if (text.length > MAX_MESSAGE_CHARS) {
        fail("BAD_REQUEST", TOO_LONG);
        return;
      }

      streamingRef.current = true;
      setStreaming(true);
      const ac = new AbortController();
      abortRef.current = ac;
      let answer = "";
      try {
        await client.chat(
          { message: text, conversation_id: conversationId.current },
          (ev) => {
            switch (ev.type) {
              case "state":
                setAvatar(ev.avatar);
                break;
              case "token":
                answer += ev.text;
                patch((m) => ({ ...m, text: answer }));
                break;
              case "citation":
                patch((m) =>
                  m.citations.some((c) => c.document_id === ev.document_id && c.heading === ev.heading)
                    ? m
                    : { ...m, citations: [...m.citations, { document_id: ev.document_id, title: ev.title, heading: ev.heading }] },
                );
                break;
              case "done":
                conversationId.current = ev.conversation_id;
                patch((m) => ({ ...m, messageId: ev.message_id }));
                latest.current.onMessage({ message_id: ev.message_id, text: answer });
                break;
              case "error":
                fail(ev.code, ev.message);
                break;
              default:
                break;
            }
          },
          ac.signal,
        );
      } catch (e) {
        if (isAbort(e) || ac.signal.aborted) {
          setAvatar("idle");
          setMessages((ms) => ms.filter((m) => m.id !== asstId || m.text !== ""));
        } else if (e instanceof ApiError) {
          if (e.code === "NOT_FOUND") conversationId.current = undefined;
          fail(e.code, e.message);
        } else {
          fail("INTERNAL", "");
        }
      } finally {
        streamingRef.current = false;
        setStreaming(false);
        if (abortRef.current === ac) abortRef.current = null;
      }
    },
    [client],
  );

  useEffect(() => {
    props.bind(send);
    return () => props.bind(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [send]);

  // Closing the panel (or unmounting) aborts the in-flight stream.
  useEffect(() => {
    if (!open) abortRef.current?.abort();
  }, [open]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const feedback = (msg: Msg, rating: 1 | -1) => {
    if (!msg.messageId || msg.rating !== undefined) return;
    const set = (r: 1 | -1 | undefined) => setMessages((ms) => ms.map((m) => (m.id === msg.id ? { ...m, rating: r } : m)));
    set(rating);
    client.feedback({ message_id: msg.messageId, rating }).catch(() => set(undefined));
  };

  // Launcher: a click without movement toggles; a drag snaps to the nearest corner.
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_THRESHOLD) return;
    d.moved = true;
    setDragPos({ x: e.clientX, y: e.clientY });
  };
  const onPointerUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false), 0);
    setDragPos(null);
    props.onCorner(nearestCorner(e.clientX, e.clientY, window.innerWidth, window.innerHeight));
  };
  const onClick = () => {
    if (suppressClick.current) return;
    props.onOpenChange(!open);
  };

  const accent = pub && SAFE_COLOR.test(pub.theme.accent) ? pub.theme.accent : undefined;
  const rootStyle: Record<string, string> = {};
  if (accent) rootStyle["--ai-theme-accent"] = accent;
  if (dragPos) {
    rootStyle.left = `${dragPos.x - LAUNCHER_SIZE / 2}px`;
    rootStyle.top = `${dragPos.y - LAUNCHER_SIZE / 2}px`;
    rootStyle.right = "auto";
    rootStyle.bottom = "auto";
  }

  return (
    <div
      class={`root ${corner}${dragPos ? " dragging" : ""}`}
      style={rootStyle}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) props.onOpenChange(false);
      }}
    >
      {open && !dragPos && (
        <Panel
          name={name}
          labels={labels}
          messages={messages}
          streaming={streaming}
          onSend={(t) => void send(t)}
          onClose={() => props.onOpenChange(false)}
          onFeedback={feedback}
        />
      )}
      <button
        type="button"
        class="launcher"
        aria-label={name}
        aria-expanded={open}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <Avatar frames={frames} state={avatar} reducedMotion={reducedMotion} name={name} />
      </button>
    </div>
  );
}
