import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { E2E_INTERNAL_KEY, FAKE_SCRIPT_PATH } from "./profit";

/**
 * Ruling 45: local E2E. No Supabase, no LLM key, no Docker.
 * - mock-pos      :4100  INTERNAL_KEY=e2e
 * - ai-service    :4000  LOCAL_MODE=1 (in-process PGlite + seed, memory blobs, hash embedder),
 *                        LLM_FAKE_SCRIPT=e2e/fake-script.json (written by global-setup from live mock-pos data)
 * - studio        :3000  next dev, /demo/pos + /api/demo-token (DEMO_ENABLED=1), dummy Supabase env
 * Servers are started with npx/tsx directly (pnpm need not be on PATH). The widget must be built first
 * (`pnpm e2e:local` does that).
 *
 * E2E_EXTERNAL=1 (`pnpm test:e2e`): no webServers; runs against an already running `pnpm dev` stack
 * (real Supabase + LLM). Only then can the admin-upload spec run.
 */
const external = process.env.E2E_EXTERNAL === "1";
const root = resolve(__dirname, "..");
const DUMMY_SUPABASE = { SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_ANON_KEY: "e2e-dummy-anon-key" };

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
  globalSetup: "./global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: external ? undefined : [
    {
      name: "mock-pos",
      command: "npx tsx src/index.ts",
      cwd: resolve(root, "apps/mock-pos"),
      url: "http://localhost:4100/.well-known/jwks.json",
      env: { INTERNAL_KEY: E2E_INTERNAL_KEY, PORT: "4100" },
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      name: "ai-service",
      command: "npx tsx src/index.ts",
      cwd: resolve(root, "apps/ai-service"),
      url: "http://localhost:4000/healthz",
      env: {
        NODE_ENV: "development",
        LOCAL_MODE: "1",
        PORT: "4000",
        POS_INTERNAL_KEY: E2E_INTERNAL_KEY,
        POS_BASE_URL: "http://localhost:4100",
        APP_ISSUERS: JSON.stringify({ pos: "http://localhost:4100/.well-known/jwks.json" }),
        LLM_FAKE_SCRIPT: FAKE_SCRIPT_PATH,
        WIDGET_DIR: resolve(root, "packages/widget/dist"),
      },
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      name: "studio",
      command: "npx next dev -p 3000",
      cwd: resolve(root, "apps/studio"),
      url: "http://localhost:3000/demo/pos",
      env: {
        AI_SERVICE_URL: "http://localhost:4000",
        MOCK_POS_URL: "http://localhost:4100",
        DEMO_ENABLED: "1",
        NEXT_TELEMETRY_DISABLED: "1",
        ...DUMMY_SUPABASE,
      },
      reuseExistingServer: false,
      timeout: 240_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
