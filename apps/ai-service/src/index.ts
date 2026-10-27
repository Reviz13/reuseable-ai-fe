import { createClient } from "@supabase/supabase-js";
import { createApp, type AppDeps } from "./app.js";
import { createAdminVerifier } from "./auth/admin.js";
import { createEndUserVerifier } from "./auth/endUser.js";
import { AuthError } from "./auth/errors.js";
import { createMemoryBlobStore, createSupabaseBlobStore } from "./blob.js";
import { loadConfig, type Config } from "./config.js";
import { createPgDb } from "./db.js";
import { createGatewayFor } from "./llm/gateway.js";
import { createPosAdapter } from "./profit/posAdapter.js";
import { createHashEmbedder, createLocalEmbedder } from "./rag/embedder.js";

if (process.env.LOCAL_MODE === "1" && process.env.NODE_ENV === "production") {
  console.error("LOCAL_MODE=1 is dev-only and refused when NODE_ENV=production");
  process.exit(1);
}

let config: Config;
try {
  config = loadConfig(process.env);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

type Wiring = Pick<AppDeps, "db" | "blob" | "verifyAdmin" | "embedder"> & { close(): Promise<void> };

async function productionWiring(c: Config): Promise<Wiring> {
  const db = createPgDb(c.databaseUrl);
  const supabase = createClient(c.supabaseUrl, c.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    db,
    blob: createSupabaseBlobStore(c.supabaseUrl, c.supabaseServiceKey),
    verifyAdmin: createAdminVerifier({
      db,
      getUser: async (token) => {
        const { data, error } = await supabase.auth.getUser(token);
        return error || !data.user ? null : { id: data.user.id };
      },
    }),
    embedder: createLocalEmbedder(),
    close: () => db.end(),
  };
}

/** Ruling 45: in-process PGlite (migrations + seed), memory blobs, hash embedder, no admin access. */
async function localWiring(): Promise<Wiring> {
  const { createLocalDb } = await import("./dev/localDb.js");
  const local = await createLocalDb();
  return {
    db: local.db,
    blob: createMemoryBlobStore(),
    verifyAdmin: async () => {
      throw new AuthError("admin routes are disabled in LOCAL_MODE");
    },
    embedder: createHashEmbedder(),
    close: () => local.close(),
  };
}

const wiring = config.localMode ? await localWiring() : await productionWiring(config);
if (config.localMode) console.warn("ai-service LOCAL_MODE: in-process PGlite, memory blobs, hash embedder; admin disabled");
if (config.llmFakeScript) console.warn(`ai-service: fake LLM script ${config.llmFakeScript}`);

const app = createApp({
  config,
  db: wiring.db,
  blob: wiring.blob,
  verifyEndUser: createEndUserVerifier(config.appIssuers),
  verifyAdmin: wiring.verifyAdmin,
  now: () => new Date(),
  embedder: wiring.embedder,
  gatewayFor: createGatewayFor(config),
  pos: createPosAdapter({ baseUrl: config.posBaseUrl, internalKey: config.posInternalKey }),
}, { logger: true });

app.addHook("onClose", async () => {
  await wiring.close();
});

await app.listen({ host: "0.0.0.0", port: config.port });
console.log(`ai-service listening on :${config.port}`);
