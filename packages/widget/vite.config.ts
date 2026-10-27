import { defineConfig } from "vite";

export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    target: "es2020",
    cssCodeSplit: false,
    lib: {
      entry: "src/element.tsx",
      formats: ["iife"],
      name: "AiAssistant",
      fileName: () => "ai-assistant.js",
    },
  },
  test: {
    environment: "happy-dom",
    include: ["test/**/*.test.{ts,tsx}"],
    css: { include: [/\.css$/, /\.css\?inline$/] },
    globals: false,
  },
});
