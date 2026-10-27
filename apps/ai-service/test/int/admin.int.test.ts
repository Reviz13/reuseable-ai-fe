import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createAdminVerifier } from "../../src/auth/admin.js";
import { createMemoryBlobStore } from "../../src/blob.js";
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
  it("no admins row -> no apps (requireAdmin answers 403, spec section 7)", async () => {
    expect(await createAdminVerifier({ getUser, db: h.db })("b")).toEqual({ user_id: NOROW, apps: [] });
  });
});

describe("requireAdmin with the real verifier (M7)", () => {
  it("valid token without an admins row -> 403; invalid token -> 401; admin -> 200", async () => {
    const app = createApp({
      config: {} as never,
      db: h.db,
      blob: createMemoryBlobStore(),
      verifyEndUser: async () => {
        throw new Error("unused");
      },
      verifyAdmin: createAdminVerifier({ getUser, db: h.db }),
      now: () => new Date(),
    });
    await app.ready();
    const hit = async (t: string) =>
      (await app.inject({ url: "/admin/pos/documents", headers: { authorization: `Bearer ${t}` } })).statusCode;
    expect(await hit("b")).toBe(403);
    expect(await hit("zzz")).toBe(401);
    expect(await hit("a")).toBe(200);
    await app.close();
  });
});
