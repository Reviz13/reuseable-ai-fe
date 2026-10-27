import { buildServer } from "./server";
import { loadOrCreateKeys } from "./keys";

const internalKey = process.env.INTERNAL_KEY;
if (!internalKey) {
  console.error("INTERNAL_KEY is required");
  process.exit(1);
}
const port = Number(process.env.PORT ?? 4100);
const keys = await loadOrCreateKeys();
const app = buildServer({ keys, internalKey, now: () => new Date() });
await app.listen({ port, host: "0.0.0.0" });
console.log(`mock-pos listening on :${port}`);
