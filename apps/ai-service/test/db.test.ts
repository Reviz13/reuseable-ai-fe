import { describe, expect, it } from "vitest";
import { pgPoolOptions } from "../src/db.js";

const REMOTE = "postgresql://postgres.ref:pw@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres";
const noFile = (p: string): string => {
  throw new Error(`unexpected read ${p}`);
};

describe("pgPoolOptions (M3)", () => {
  it("verifies TLS against the system CAs for a remote host by default", () => {
    expect(pgPoolOptions(REMOTE, {}, noFile)).toEqual({ connectionString: REMOTE, ssl: { rejectUnauthorized: true } });
  });
  it("uses DATABASE_SSL_CA when set", () => {
    const o = pgPoolOptions(REMOTE, { DATABASE_SSL_CA: "ca.crt" }, (p) => `PEM:${p}`);
    expect(o.ssl).toEqual({ ca: "PEM:ca.crt", rejectUnauthorized: true });
  });
  it("DATABASE_SSL=no-verify encrypts without verifying", () => {
    expect(pgPoolOptions(REMOTE, { DATABASE_SSL: "no-verify" }, noFile).ssl).toEqual({ rejectUnauthorized: false });
  });
  it("DATABASE_SSL=disable turns TLS off", () => {
    expect(pgPoolOptions(REMOTE, { DATABASE_SSL: "disable" }, noFile).ssl).toBeUndefined();
  });
  it.each(["localhost", "127.0.0.1", "[::1]"])("no TLS for %s", (host) => {
    expect(pgPoolOptions(`postgresql://u:p@${host}:5432/db`, {}, noFile).ssl).toBeUndefined();
  });
  it("drops ssl parameters from the URL so they cannot override the options", () => {
    const o = pgPoolOptions(`${REMOTE}?sslmode=disable&application_name=ai`, {}, noFile);
    expect(o.connectionString).not.toMatch(/sslmode/);
    expect(o.connectionString).toMatch(/application_name=ai/);
    expect(o.ssl).toEqual({ rejectUnauthorized: true });
  });
  it("rejects an unknown DATABASE_SSL value", () => {
    expect(() => pgPoolOptions(REMOTE, { DATABASE_SSL: "maybe" }, noFile)).toThrow(/DATABASE_SSL/);
  });
});
