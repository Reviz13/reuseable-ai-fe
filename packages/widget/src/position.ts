export type Position = "top-left" | "top-right" | "bottom-left" | "bottom-right";

const POSITIONS: readonly string[] = ["top-left", "top-right", "bottom-left", "bottom-right"];

export const isPosition = (v: unknown): v is Position => typeof v === "string" && POSITIONS.includes(v);

export function nearestCorner(x: number, y: number, vw: number, vh: number): Position {
  return `${y < vh / 2 ? "top" : "bottom"}-${x < vw / 2 ? "left" : "right"}` as Position;
}

const key = (app: string) => `ai-assistant:${app}:position`;

export function loadPosition(app: string): Position | null {
  try {
    const v = localStorage.getItem(key(app));
    return isPosition(v) ? v : null;
  } catch {
    return null;
  }
}

export function savePosition(app: string, pos: Position): void {
  try {
    localStorage.setItem(key(app), pos);
  } catch {
    /* storage unavailable: the corner just is not remembered */
  }
}
