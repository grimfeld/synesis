// Development only: when the app is opened in a plain browser (not the Tauri
// webview), route `invoke` to the debug HTTP bridge in src-tauri/src/devbridge.rs.
// Events and native plugins are stubbed.
declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
  let counter = 0;
  const w = window as unknown as Record<string, unknown>;
  w.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
    transformCallback(cb: (...a: unknown[]) => void) {
      const id = ++counter;
      w[`_${id}`] = cb;
      return id;
    },
    async invoke(cmd: string, args: Record<string, unknown> = {}) {
      if (cmd.startsWith("plugin:")) return null;
      const r = await fetch(`http://127.0.0.1:4321/invoke/${cmd}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(args ?? {}) });
      const text = await r.text();
      const j = text ? JSON.parse(text) : null;
      if (!r.ok) throw j?.error ?? j;
      return j;
    },
  };
  w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  console.info("[devbridge] using HTTP bridge on :4321");
}

export {};
