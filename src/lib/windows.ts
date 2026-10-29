// Desktop Windows (spec #35, issue #51).
//
// "Open in new Window" asks the engine for a separate app Window on one
// document; each Window has its own Panes and history. Every Window talks to
// the same engine process, so the engine is also the go-between for the text:
// each Window tells it which documents it shows (`show_documents`) and sends
// its edits (`relay_edit`); the engine passes an edit to the other Windows
// showing that document as `doc:edited`, which lands in their LiveDocument's
// `receive`.
//
// Not on phones and not in the web build. Not through the dev bridge either:
// a plain browser has no Tauri to make a Window with.
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isDesktopApp } from "@/lib/updater";

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

/** The label of the Window the app starts with (`engine::windows::MAIN`). */
export const MAIN_WINDOW = "main";

/**
 * Whether this is a secondary Window: one opened with "Open in new Window".
 * It shares the main Window's open Vault rather than opening it again, and
 * does not save its Panes as the Vault's layout.
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

export interface WindowSync {
  /** A document opened here; the returned function closes it. */
  opened(id: string): () => void;
  /** An edit made here: the whole text. */
  edited(id: string, text: string): void;
}

/**
 * What this Window tells the engine. Edits are sent after a short pause with
 * the latest text, so a burst of typing is one message rather than one per
 * key, and at once when the document closes here.
 */
export function createWindowSync(o: {
  send: (id: string, text: string) => void;
  show: (ids: string[]) => void;
  delay?: number;
}): WindowSync {
  const delay = o.delay ?? 30;
  const counts = new Map<string, number>();
  const pending = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = (only?: string) => {
    for (const [id, text] of [...pending]) {
      if (only !== undefined && id !== only) continue;
      pending.delete(id);
      o.send(id, text);
    }
  };
  const tellShown = () => o.show([...counts.keys()].sort());

  return {
    opened(id) {
      const n = counts.get(id) ?? 0;
      counts.set(id, n + 1);
      if (n === 0) tellShown();
      let closed = false;
      return () => {
        if (closed) return;
        closed = true;
        flush(id);
        const left = (counts.get(id) ?? 1) - 1;
        if (left > 0) return void counts.set(id, left);
        counts.delete(id);
        tellShown();
      };
    },
    edited(id, text) {
      pending.set(id, text);
      clearTimeout(timer);
      timer = setTimeout(() => flush(), delay);
    },
  };
}

/** This Window's sync through the engine, or null where there are no Windows. */
export function engineWindowSync(): WindowSync | null {
  if (!windowsOffered()) return null;
  const quiet = (p: Promise<unknown>) => void p.catch(console.error);
  return createWindowSync({
    send: (id, text) => quiet(invoke("relay_edit", { id, text })),
    show: (ids) => quiet(invoke("show_documents", { ids })),
  });
}

/** Edits from other Windows, for the documents this one shows. */
export function onEditedElsewhere(cb: (id: string, text: string) => void): Promise<UnlistenFn> {
  return listen<{ id: string; text: string }>("doc:edited", (e) => cb(e.payload.id, e.payload.text));
}
