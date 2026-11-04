// The desktop auto-updater: tauri-plugin-updater asks
// https://github.com/grimfeld/synesis/releases/latest/download/latest.json
// (tauri.conf.json `plugins.updater`) whether a newer release exists, checks
// its signature against the public key there, and installs it; the process
// plugin restarts the app afterwards. Phones update through their stores and
// the web build is a demo, so neither has an updater.
//
// One module-level state so the start-up check, the banner and the Settings
// card all see the same answer.
import { useSyncExternalStore } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";

/** True in the desktop app: not the web build, not a phone. */
export function isDesktopApp(
  mode: string = import.meta.env.MODE,
  userAgent: string = typeof navigator === "undefined" ? "" : navigator.userAgent,
): boolean {
  return mode !== "web" && !/Android|iPhone|iPad/.test(userAgent);
}

/**
 * Whether to look for an update quietly at start-up: on desktop, in a release
 * build (a dev build would offer to replace itself with the last release), and
 * unless the Device turned it off. `enabled` is undefined until the settings load.
 */
export function shouldCheckOnStart(o: { desktop: boolean; dev: boolean; enabled: boolean | undefined }): boolean {
  return o.desktop && !o.dev && o.enabled !== false;
}

export type UpdaterStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available"; version: string }
  | { kind: "installing"; version: string }
  /** `version` is set when installing it failed, so the banner can say so. */
  | { kind: "error"; message: string; version?: string };

let status: UpdaterStatus = { kind: "idle" };
let update: Update | null = null;
/** The banner was closed for this version; Settings still shows it. */
let dismissed: string | null = null;
const listeners = new Set<() => void>();

function set(next: UpdaterStatus) {
  status = next;
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/**
 * Ask whether a newer release exists. `quiet` keeps a failed check (offline,
 * no release yet) out of sight: the start-up check must never nag.
 */
export async function checkForUpdate(quiet = false): Promise<void> {
  if (status.kind === "checking" || status.kind === "installing") return;
  const before = status;
  set({ kind: "checking" });
  try {
    const found = await check();
    update = found;
    set(found ? { kind: "available", version: found.version } : { kind: "current" });
  } catch (e) {
    set(quiet ? before : { kind: "error", message: String(e) });
  }
}

/**
 * Every Window saves its typing (`flush_all_windows`, a few seconds at most),
 * then the update is installed and the app restarts. Saving comes first: on
 * Windows the installer closes the app itself. A save that fails is logged
 * and the update goes ahead, as quitting would.
 */
export async function applyUpdate(
  u: { downloadAndInstall(): Promise<void> },
  o: { flush: () => Promise<void>; relaunch: () => Promise<void> },
): Promise<void> {
  try {
    await o.flush();
  } catch (e) {
    console.error(e);
  }
  await u.downloadAndInstall();
  await o.relaunch();
}

/** Download and install the update found, then start the new version. */
export async function installUpdate(): Promise<void> {
  // From the banner or Settings, and again after a failed attempt.
  if (!update || status.kind === "checking" || status.kind === "installing") return;
  const version = update.version;
  set({ kind: "installing", version });
  try {
    await applyUpdate(update, {
      flush: () => invoke("flush_all_windows"),
      relaunch,
    });
  } catch (e) {
    set({ kind: "error", message: String(e), version });
  }
}

export function dismissUpdate() {
  if (status.kind === "available" || status.kind === "error") dismissed = status.version ?? null;
  // A new object, so the subscribers see a change.
  set({ ...status });
}

export function useUpdater() {
  const s = useSyncExternalStore(subscribe, () => status);
  return {
    status: s,
    /** Show the banner: an update is there and was not closed. */
    banner:
      s.kind === "installing" ||
      ((s.kind === "available" || (s.kind === "error" && s.version !== undefined)) && s.version !== dismissed),
  };
}
