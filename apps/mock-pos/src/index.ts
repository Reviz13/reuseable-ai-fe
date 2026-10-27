import { buildServer, mockPosPort } from "./server";
import { loadOrCreateKeys } from "./keys";

const internalKey = process.env.INTERNAL_KEY;
if (!internalKey) {
  console.error("INTERNAL_KEY is required");
  process.exit(1);
}
const port = mockPosPort(process.env);
const keys = await loadOrCreateKeys();
const app = buildServer({ keys, internalKey, now: () => new Date() });
await app.listen({ port, host: "0.0.0.0" });
console.log(`mock-pos listening on :${port}`);
