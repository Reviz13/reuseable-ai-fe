import { act, render } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Avatar } from "../src/Avatar";
import { FRAMES } from "./helpers";

const active = (c: Element) => c.querySelector("img[data-active]")?.getAttribute("data-state");

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Avatar", () => {
  it("stacks all five frames with alt = name and a 120ms transition", () => {
    const { container } = render(<Avatar frames={FRAMES} state="idle" reducedMotion={false} name="Kopi Bot" />);
    const imgs = container.querySelectorAll("img");
    expect(imgs).toHaveLength(5);
    expect([...imgs].every((i) => i.getAttribute("alt") === "Kopi Bot")).toBe(true);
    const idle = container.querySelector('img[data-state="idle"]') as HTMLElement;
    expect(idle.style.opacity).toBe("1");
    expect(idle.style.transition).toContain("120ms");
    expect((container.querySelector('img[data-state="sad"]') as HTMLElement).style.opacity).toBe("0");
  });

  it("follows thinking -> talking -> happy and reverts happy to idle after 2000ms", async () => {
    const { container, rerender } = render(<Avatar frames={FRAMES} state="idle" reducedMotion={false} name="b" />);
    rerender(<Avatar frames={FRAMES} state="thinking" reducedMotion={false} name="b" />);
    expect(active(container)).toBe("thinking");
    rerender(<Avatar frames={FRAMES} state="talking" reducedMotion={false} name="b" />);
    expect(active(container)).toBe("talking");
    rerender(<Avatar frames={FRAMES} state="happy" reducedMotion={false} name="b" />);
    expect(active(container)).toBe("happy");
    await act(() => { vi.advanceTimersByTime(1900); });
    expect(active(container)).toBe("happy");
    await act(() => { vi.advanceTimersByTime(150); });
    expect(active(container)).toBe("idle");
  });

  it("alternates talking/idle every 180ms", async () => {
    const { container } = render(<Avatar frames={FRAMES} state="talking" reducedMotion={false} name="b" />);
    expect(active(container)).toBe("talking");
    await act(() => { vi.advanceTimersByTime(180); });
    expect(active(container)).toBe("idle");
    await act(() => { vi.advanceTimersByTime(180); });
    expect(active(container)).toBe("talking");
  });

  it("never shows idle while talking with reduced motion, and drops the transition", async () => {
    const { container } = render(<Avatar frames={FRAMES} state="talking" reducedMotion={true} name="b" />);
    for (let i = 0; i < 5; i++) {
      await act(() => { vi.advanceTimersByTime(180); });
      expect(active(container)).toBe("talking");
    }
    expect((container.querySelector("img") as HTMLElement).style.transition).not.toContain("120ms");
  });
});
