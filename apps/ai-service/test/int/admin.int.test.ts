import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdminVerifier } from "../../src/auth/admin.js";
import { AuthError } from "../../src/auth/errors.js";
import { createTestDb } from "./pglite.js";

const ADMIN = "11111111-1111-1111-1111-111111111111";
const NOROW = "22222222-2222-2222-2222-222222222222";
let h: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  h = await createTestDb();
  await h.pg.exec(`insert into auth.users (id, email) values ('${ADMIN}','a@x'),('${NOROW}','b@x');
    insert into admins (user_id, apps) values ('${ADMIN}', '{pos}')`);
});
afterAll(() => h.close());

const getUser = async (t: string) => (t === "a" ? { id: ADMIN } : t === "b" ? { id: NOROW } : null);

describe("admin verifier", () => {
  it("returns user and apps", async () => {
    const v = createAdminVerifier({ getUser, db: h.db });
    expect(await v("a")).toEqual({ user_id: ADMIN, apps: ["pos"] });
  });
  it("invalid token -> AuthError", async () => {
    await expect(createAdminVerifier({ getUser, db: h.db })("zzz")).rejects.toBeInstanceOf(AuthError);
  });
  it("no admins row -> AuthError", async () => {
    await expect(createAdminVerifier({ getUser, db: h.db })("b")).rejects.toBeInstanceOf(AuthError);
  });
});
