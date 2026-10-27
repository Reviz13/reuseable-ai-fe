export interface Embedder {
  embed(texts: string[], kind: "query" | "passage"): Promise<number[][]>;
  model: string;
}

export const EMBEDDING_DIMS = 384;
const E5_MODEL = "Xenova/multilingual-e5-small";

/** Minimal shape of a transformers.js feature-extraction pipeline. */
export type FeaturePipeline = (
  texts: string[],
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

export interface LocalEmbedderOpts {
  /** Injected in tests so the real model is never downloaded. */
  pipelineFactory?: () => Promise<FeaturePipeline>;
}

async function defaultPipelineFactory(): Promise<FeaturePipeline> {
  // Lazy: importing this module must not load onnxruntime or the model.
  const { pipeline } = await import("@huggingface/transformers");
  return (await pipeline("feature-extraction", E5_MODEL)) as unknown as FeaturePipeline;
}

export function createLocalEmbedder(opts: LocalEmbedderOpts = {}): Embedder {
  const factory = opts.pipelineFactory ?? defaultPipelineFactory;
  let loading: Promise<FeaturePipeline> | undefined;
  const load = (): Promise<FeaturePipeline> => {
    loading ??= factory().catch((err) => {
      loading = undefined; // allow retry after a failed load
      throw err;
    });
    return loading;
  };
  return {
    model: "multilingual-e5-small",
    async embed(texts, kind) {
      if (texts.length === 0) return [];
      const prefix = kind === "query" ? "query: " : "passage: ";
      const run = await load();
      const out = await run(
        texts.map((t) => prefix + t),
        { pooling: "mean", normalize: true },
      );
      return out.tolist();
    },
  };
}

function fnv1a(s: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic bag-of-words hash embedder. For tests only. */
export function createHashEmbedder(): Embedder {
  return {
    model: "hash-384",
    async embed(texts) {
      return texts.map((text) => {
        const v = new Array<number>(EMBEDDING_DIMS).fill(0);
        for (const tok of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
          if (!tok) continue;
          const bucket = fnv1a(tok) % EMBEDDING_DIMS;
          const sign = (fnv1a(tok, 0x9747b28c) & 1) === 0 ? 1 : -1;
          v[bucket]! += sign;
        }
        const norm = Math.hypot(...v);
        return norm === 0 ? v : v.map((x) => x / norm);
      });
    },
  };
}
