import { defineConfig } from "cypress";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

// End-to-end tests drive the UI served by Vite (`npm run tauri dev` must be
// running: it serves http://localhost:1420 and the engine over the debug HTTP
// bridge on 127.0.0.1:4321). Every spec works on a fresh copy of
// examples/demo-vault in the temp directory; the vault that was open before
// the run is reopened afterwards (see cypress/support/e2e.ts).
const BRIDGE = "http://127.0.0.1:4321";

/** Tauri's `app_data_dir()` for this app: where per-vault indexes live. */
function appDataDir(): string {
  const id = "tech.grimfeld.synesis";
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), id);
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", id);
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), id);
}

/**
 * The index and history the app keeps for a vault opened at `path`
 * (`engine::vault::local_dir_for`: the first 8 bytes of the path's SHA-256).
 * Opening a seeded copy makes one, so removing the copy removes it too.
 */
function localDirFor(path: string): string {
  return join(appDataDir(), "vaults", createHash("sha256").update(path, "utf8").digest("hex").slice(0, 16));
}

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
        /**
         * Remove a seeded copy and the index the app built for it. Only paths
         * under a `synesis-cy-` folder, so a real vault is never touched. The
         * vault must be closed first (another one opened, or close_vault).
         */
        "vault:remove"(dir: string): null {
          if (!dir || !dir.includes("synesis-cy-")) return null;
          const gone = { recursive: true, force: true, maxRetries: 5, retryDelay: 200 };
          if (existsSync(dir)) rmSync(dir, gone);
          rmSync(localDirFor(dir), gone);
          return null;
        },
        /**
         * Write a file, creating its parents. Used to plant a device folder in
         * a seeded vault's `sync/`, the way a retired Device leaves one behind.
         * Confined to the temp copies, so a spec cannot touch a real vault.
         */
        "file:write"({ path, text }: { path: string; text: string }): null {
          if (!path.includes("synesis-cy-")) throw new Error(`refusing to write outside a seeded vault: ${path}`);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, text);
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
