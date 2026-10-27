import { describe, expect, it, vi } from "vitest";
import { afterListen, installGracefulShutdown } from "../src/startup.js";

const log = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe("afterListen (S6, S7)", () => {
  it("non-LOCAL: sweeps interrupted versions and warms the embedder without awaiting it", async () => {
    let release!: () => void;
    const embed = vi.fn(() => new Promise<number[][]>((r) => (release = () => r([[1]]))));
    const sweep = vi.fn(async () => 2);
    const l = log();
    await afterListen({ localMode: false, embedder: { embed, model: "m" }, sweep, log: l });
    expect(sweep).toHaveBeenCalledOnce();
    expect(embed).toHaveBeenCalledWith(["warmup"], "query");
    expect(l.info).toHaveBeenCalledWith(expect.stringContaining("2 interrupted"));
    release();
    await vi.waitFor(() => expect(l.info).toHaveBeenCalledWith(expect.stringContaining("warm")));
  });
  it("a failed warm-up or sweep is logged, never thrown", async () => {
    const l = log();
    await afterListen({
      localMode: false,
      embedder: { embed: async () => Promise.reject(new Error("no model")), model: "m" },
      sweep: async () => Promise.reject(new Error("db down")),
      log: l,
    });
    await vi.waitFor(() => expect(l.warn).toHaveBeenCalledTimes(2));
  });
  it("LOCAL_MODE: no sweep, no warm-up", async () => {
    const embed = vi.fn();
    const sweep = vi.fn();
    await afterListen({ localMode: true, embedder: { embed, model: "m" }, sweep, log: log() });
    expect(embed).not.toHaveBeenCalled();
    expect(sweep).not.toHaveBeenCalled();
  });
});

describe("installGracefulShutdown (S7)", () => {
  it("SIGTERM closes the app (which ends the pool) then exits 0, once", async () => {
    const handlers = new Map<string, () => void>();
    const proc = { once: (sig: string, h: () => void) => void handlers.set(sig, h) };
    const order: string[] = [];
    const app = { close: vi.fn(async () => void order.push("close")) };
    const exit = vi.fn((code: number) => void order.push(`exit ${code}`));
    installGracefulShutdown(app, proc, exit, log());
    expect([...handlers.keys()].sort()).toEqual(["SIGINT", "SIGTERM"]);
    handlers.get("SIGTERM")!();
    handlers.get("SIGINT")!();
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());
    expect(order).toEqual(["close", "exit 0"]);
    expect(app.close).toHaveBeenCalledOnce();
  });
  it("exits 1 when close fails", async () => {
    const handlers = new Map<string, () => void>();
    const exit = vi.fn();
    installGracefulShutdown({ close: async () => Promise.reject(new Error("x")) }, { once: (s: string, h: () => void) => void handlers.set(s, h) }, exit, log());
    handlers.get("SIGINT")!();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  });
});
