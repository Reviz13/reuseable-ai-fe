import type { Embedder } from "./rag/embedder.js";

type Log = { info(msg: string): void; warn(msg: string): void };
const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Runs after listen (non-LOCAL only):
 * - S7: sweeps ingestions a restart cut off (awaited, so the log line precedes traffic stats).
 * - S6: warms the e5 model with one query embedding, fire-and-forget, so the first chat does not
 *   pay the model load.
 * Failures are logged, never thrown: the service keeps serving.
 */
export async function afterListen(opts: {
  localMode: boolean;
  embedder: Embedder;
  sweep: () => Promise<number>;
  log: Log;
}): Promise<void> {
  if (opts.localMode) return;
  try {
    const n = await opts.sweep();
    opts.log.info(`startup sweeper: ${n} interrupted document version(s) marked failed`);
  } catch (err) {
    opts.log.warn(`startup sweeper failed: ${msg(err)}`);
  }
  const started = Date.now();
  opts.log.info("embedder warm-up started");
  void opts.embedder.embed(["warmup"], "query").then(
    () => opts.log.info(`embedder warm-up done in ${Date.now() - started} ms`),
    (err) => opts.log.warn(`embedder warm-up failed: ${msg(err)}`),
  );
}

/** S7: SIGINT/SIGTERM close the app (onClose ends the pool), then exit 0 (1 if closing failed). */
export function installGracefulShutdown(
  app: { close(): Promise<unknown> },
  proc: { once(signal: "SIGINT" | "SIGTERM", handler: () => void): unknown },
  exit: (code: number) => void,
  log: Log,
): void {
  let closing = false;
  const handler = (signal: string) => () => {
    if (closing) return;
    closing = true;
    log.info(`${signal} received, shutting down`);
    app.close().then(
      () => exit(0),
      (err) => {
        log.warn(`shutdown failed: ${msg(err)}`);
        exit(1);
      },
    );
  };
  proc.once("SIGINT", handler("SIGINT"));
  proc.once("SIGTERM", handler("SIGTERM"));
}
