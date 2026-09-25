import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { execSync } from "node:child_process";
import pkg from "./package.json";

const host = process.env.TAURI_DEV_HOST;

// What Settings > About shows. Vercel builds without a .git folder, so its
// commit comes from the environment; any build with neither says "unknown".
const git = (args: string) => {
  try {
    return execSync(`git ${args}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
};
const commit = git("rev-parse HEAD") || process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || "";
const commitDate = git("log -1 --format=%cI");

// `web` is the browser test build (scripts/build-web.mjs, src/lib/webengine.ts):
// the engine as WebAssembly plus the demo vault, served from `target/web`.
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**", "**/crates/**", "**/target/**"] },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(commit),
    __APP_COMMIT_DATE__: JSON.stringify(commitDate),
    __APP_BUILT__: JSON.stringify(new Date().toISOString()),
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  publicDir: mode === "web" ? "target/web" : "public",
  build: {
    outDir: mode === "web" ? "dist-web" : "dist",
    // The WASI shim uses BigInt literals, which Safari 13 predates.
    target: mode === "web" ? "es2020" : process.env.TAURI_ENV_PLATFORM == "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
}));
