import type { AvatarState } from "@ai/contracts";
import { useEffect, useState } from "preact/hooks";

const STATES: AvatarState[] = ["idle", "thinking", "talking", "happy", "sad"];

export interface AvatarProps {
  frames: Record<AvatarState, string>;
  state: AvatarState;
  reducedMotion: boolean;
  name: string;
}

/** Stacked frames. `state` is server driven; happy->idle (2000 ms) and talking<->idle (180 ms) are local. */
export function Avatar({ frames, state, reducedMotion, name }: AvatarProps) {
  // Tagged with the state they belong to, so a stale value never leaks into the next state.
  const [happyDone, setHappyDone] = useState<AvatarState | null>(null);
  const [tick, setTick] = useState<{ state: AvatarState; n: number }>({ state, n: 0 });

  useEffect(() => {
    if (state === "happy") {
      const t = setTimeout(() => setHappyDone("happy"), 2000);
      return () => {
        clearTimeout(t);
        setHappyDone(null);
      };
    }
    if (state === "talking" && !reducedMotion) {
      setTick({ state, n: 0 });
      const t = setInterval(() => setTick((p) => ({ state, n: (p.state === state ? p.n : 0) + 1 })), 180);
      return () => clearInterval(t);
    }
  }, [state, reducedMotion]);

  let shown: AvatarState = state;
  if (state === "happy" && happyDone === "happy") shown = "idle";
  else if (state === "talking" && !reducedMotion && tick.state === "talking" && tick.n % 2 === 1) shown = "idle";

  return (
    <div class="avatar">
      {STATES.map((s) => (
        <img
          key={s}
          src={frames[s]}
          alt={name}
          data-state={s}
          data-active={s === shown ? "" : undefined}
          draggable={false}
          style={{ opacity: s === shown ? 1 : 0, transition: reducedMotion ? "none" : "opacity 120ms linear" }}
        />
      ))}
    </div>
  );
}
