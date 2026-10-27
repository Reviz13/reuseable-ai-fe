import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"], exclude: ["test/int/**", "node_modules/**"], passWithNoTests: true },
});
