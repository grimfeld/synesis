// Development only: when the app is opened in a plain browser (not the Tauri
// webview), route `invoke` to the debug HTTP bridge in src-tauri/src/devbridge.rs.
// Native plugins are stubbed, and the engine's events do not reach the page;
// a test plays one with `window.__devEmit(event, payload)` (an outside edit
// the watcher would announce).
declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
  let counter = 0;
  const w = window as unknown as Record<string, unknown>;
  /** Listener callback ids by event name. */
  const listeners = new Map<string, Set<number>>();
  const unlisten = (event: string, id: number) => listeners.get(event)?.delete(id);
  w.__devEmit = (event: string, payload: unknown) => {
    for (const id of listeners.get(event) ?? []) {
      (w[`_${id}`] as ((e: unknown) => void) | undefined)?.({ event, id, payload });
    }
  };
  w.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
    transformCallback(cb: (...a: unknown[]) => void) {
      const id = ++counter;
      w[`_${id}`] = cb;
      return id;
    },
    async invoke(cmd: string, args: Record<string, unknown> = {}) {
      if (cmd === "plugin:event|listen") {
        const { event, handler } = args as { event: string; handler: number };
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(handler);
        return handler;
      }
      if (cmd === "plugin:event|unlisten") {
        const { event, eventId } = args as { event: string; eventId: number };
        unlisten(event, eventId);
        return null;
      }
      if (cmd.startsWith("plugin:")) return null;
      const r = await fetch(`http://127.0.0.1:4321/invoke/${cmd}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(args ?? {}) });
      const text = await r.text();
      const j = text ? JSON.parse(text) : null;
      if (!r.ok) throw j?.error ?? j;
      return j;
    },
  };
  w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: unlisten };
  console.info("[devbridge] using HTTP bridge on :4321");
}

export {};
