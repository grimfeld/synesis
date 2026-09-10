#!/usr/bin/env node
// npm-facing wrapper so `npm run setup` / `npm run dev:all` reach scripts/dev
// on every OS. npm runs scripts through cmd.exe on Windows, which cannot run
// a bash script or a forward-slash path, so route through scripts/dev.cmd.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const result =
  process.platform === "win32"
    ? spawnSync("cmd.exe", ["/d", "/c", join(here, "dev.cmd"), ...args], {
        stdio: "inherit",
        env: { ...process.env, SYNESIS_DEV_NO_PAUSE: "1" },
      })
    : spawnSync(join(here, "dev"), args, { stdio: "inherit" });
process.exit(result.status ?? 1);
