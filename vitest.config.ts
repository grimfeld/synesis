import { defineConfig } from "vitest/config";
import path from "node:path";

// Unit tests for pure TypeScript in src/lib (no engine, no Tauri): `npm run test:unit`.
// UI end-to-end tests stay in Cypress (`npm run test:e2e`).
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "jsdom",
  },
});
