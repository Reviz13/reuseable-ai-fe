import { createClient } from "@supabase/supabase-js";
import { createApp } from "./app.js";
import { createAdminVerifier } from "./auth/admin.js";
import { createEndUserVerifier } from "./auth/endUser.js";
import { createSupabaseBlobStore } from "./blob.js";
import { loadConfig } from "./config.js";
import { createPgDb } from "./db.js";
import { createGatewayFor } from "./llm/gateway.js";
import { createPosAdapter } from "./profit/posAdapter.js";
import { createLocalEmbedder } from "./rag/embedder.js";

const config = loadConfig(process.env);
const db = createPgDb(config.databaseUrl);
const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const app = createApp({
  config,
  db,
  blob: createSupabaseBlobStore(config.supabaseUrl, config.supabaseServiceKey),
  verifyEndUser: createEndUserVerifier(config.appIssuers),
  verifyAdmin: createAdminVerifier({
    db,
    getUser: async (token) => {
      const { data, error } = await supabase.auth.getUser(token);
      return error || !data.user ? null : { id: data.user.id };
    },
  }),
  now: () => new Date(),
  embedder: createLocalEmbedder(),
  gatewayFor: createGatewayFor(config),
  pos: createPosAdapter({ baseUrl: config.posBaseUrl, internalKey: config.posInternalKey }),
}, { logger: true });

app.addHook("onClose", async () => {
  await db.end();
});

await app.listen({ host: "0.0.0.0", port: config.port });
console.log(`ai-service listening on :${config.port}`);
