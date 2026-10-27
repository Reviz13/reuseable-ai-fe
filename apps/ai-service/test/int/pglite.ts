// The harness lives in src/dev/localDb.ts (shared with ai-service LOCAL_MODE, Ruling 45).
import { createLocalDb, type LocalDb } from "../../src/dev/localDb.js";

export { pgliteDb } from "../../src/dev/localDb.js";

export function createTestDb(): Promise<LocalDb> {
  return createLocalDb();
}
