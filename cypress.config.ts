import { defineConfig } from "cypress";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

// End-to-end tests drive the UI served by Vite (`npm run tauri dev` must be
// running: it serves http://localhost:1420 and the engine over the debug HTTP
// bridge on 127.0.0.1:4321). Every spec works on a fresh copy of
// examples/demo-vault in the temp directory; the vault that was open before
// the run is reopened afterwards (see cypress/support/e2e.ts).
const BRIDGE = "http://127.0.0.1:4321";

export default defineConfig({
  e2e: {
    baseUrl: "http://localhost:1420",
    specPattern: "cypress/e2e/**/*.cy.ts",
    supportFile: "cypress/support/e2e.ts",
    viewportWidth: 1400,
    viewportHeight: 900,
    video: false,
    screenshotOnRunFailure: true,
    defaultCommandTimeout: 8000,
    env: { bridge: BRIDGE },
    setupNodeEvents(on) {
      on("task", {
        /** Copy the demo vault to a temp folder and return its absolute path. */
        "vault:seed"(): string {
          const dir = mkdtempSync(join(tmpdir(), "synesis-cy-"));
          cpSync(join(ROOT, "examples", "demo-vault"), dir, {
            recursive: true,
            filter: (src) =>
              !/[\\/]\.bible-study[\\/]sync([\\/]|$)/.test(src) &&
              !/[\\/]Scripture([\\/]|$)/.test(src),
          });
          return dir;
        },
        "vault:remove"(dir: string): null {
          if (dir && existsSync(dir) && dir.includes("synesis-cy-"))
            rmSync(dir, { recursive: true, force: true });
          return null;
        },
        "file:read"(path: string): string | null {
          return existsSync(path) ? readFileSync(path, "utf8") : null;
        },
        "file:exists"(path: string): boolean {
          return existsSync(path);
        },
      });
    },
  },
});
