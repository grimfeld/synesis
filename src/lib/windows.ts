// Desktop Windows (spec #35, issue #51).
//
// "Open in new Window" asks the engine for a separate app Window on one
// document; each Window has its own Panes and history. Every Window talks to
// the same engine process, so the engine also keeps their text the same: a
// Window showing a document joins its session (`doc_join`), sends its changes
// (`doc_sync`) and hears that another Window changed it (`doc:poke`). The
// rebasing is `src/lib/docSync.ts`, the ordering `engine::windows`.
//
// No typing may be lost to a Window closing: a secondary Window saves before
// it closes; the main Window, before the app quits or the Vault changes, has
// every Window save first (`windows:flush`, `close_other_windows`).
//
// Not on phones and not in the web build. Not through the dev bridge either:
// a plain browser has no Tauri to make a Window with.
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isDesktopApp } from "@/lib/updater";
import type { SyncReply, SyncTransport } from "@/lib/docSync";

/** Whether this app can open Windows: the desktop app, in Tauri itself. */
export function windowsOffered(
  o: { mode: string; userAgent: string; tauri: boolean } = {
    mode: import.meta.env.MODE,
    userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
    tauri: isTauri(),
  },
): boolean {
  return o.tauri && isDesktopApp(o.mode, o.userAgent);
}

/**
 * The label of the Window the app starts with. Also `engine::windows::MAIN`;
 * secondary Windows are `doc-<n>`, granted as `doc-*` in
 * `src-tauri/capabilities/default.json`.
 */
export const MAIN_WINDOW = "main";

/**
 * Whether this is a secondary Window: one opened with "Open in new Window".
 * It shares the main Window's open Vault rather than opening it again, cannot
 * open, close or switch Vaults, and does not save its Panes as the Vault's layout.
 */
export function isSecondaryWindow(): boolean {
  if (!windowsOffered()) return false;
  try {
    return getCurrentWindow().label !== MAIN_WINDOW;
  } catch {
    return false;
  }
}

/** Open `id` in a new Window. */
export function openInNewWindow(id: string): Promise<void> {
  return invoke("open_window", { id });
}

/**
 * The document this Window was opened on, when it is a secondary Window just
 * opening; null in the main Window, and after the first ask.
 */
export async function windowStart(): Promise<string | null> {
  if (!windowsOffered()) return null;
  try {
    return await invoke<string | null>("window_start");
  } catch {
    return null;
  }
}

/** The engine's Window sessions, or null where there are no Windows. */
export function engineSyncTransport(): SyncTransport | null {
  if (!windowsOffered()) return null;
  return {
    join: (id, client, text) => invoke("doc_join", { id, client, text }),
    sync: (req) => invoke<SyncReply>("doc_sync", { req }),
    leave: (id, client) => invoke("doc_leave", { id, client }),
  };
}

/** Another Window changed `id`. */
export function onChangedElsewhere(cb: (id: string) => void): void {
  listen<{ id: string }>("doc:poke", (e) => cb(e.payload.id)).catch(console.error);
}

/** How long a Window waits for its saves before it closes anyway. */
export const FLUSH_MS = 3000;

/**
 * Run `flush`, then `then`, even when the flush fails or takes longer than
 * `ms`: a Window must still close if the engine is gone.
 */
export async function flushThen(
  flush: () => Promise<void>,
  then: () => Promise<void> | void,
  ms = FLUSH_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      flush(),
      new Promise<void>((r) => {
        timer = setTimeout(r, ms);
      }),
    ]);
  } catch (e) {
    console.error(e);
  } finally {
    clearTimeout(timer);
  }
  await then();
}

/**
 * Save before this Window goes: when its close button is pressed (a
 * secondary Window), when the main Window has the Vault change or the app
 * quit (`windows:close`, `windows:flush`). `flush` saves everything pending.
 */
export function guardWindowClose(flush: () => Promise<void>): void {
  if (!windowsOffered()) return;
  const win = getCurrentWindow();
  const destroy = () => win.destroy();
  // The main Window's close is the app's, handled in the shell (it may only
  // hide to the tray, or quit after every Window saved).
  if (win.label !== MAIN_WINDOW) {
    win.onCloseRequested(() => flushThen(flush, () => {})).catch(console.error);
    listen("windows:close", () => void flushThen(flush, destroy)).catch(console.error);
  }
  listen("windows:flush", () => void flushThen(flush, () => invoke("window_flushed"))).catch(
    console.error,
  );
}

/**
 * Before the main Window changes the Vault: every other Window saves and
 * closes, so none writes into the next Vault.
 */
export async function closeOtherWindows(): Promise<void> {
  if (!windowsOffered()) return;
  await invoke("close_other_windows");
}
