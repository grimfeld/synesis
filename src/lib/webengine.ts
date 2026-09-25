// The web test build (`vite --mode web`, `scripts/build-web.mjs`): run the
// engine in the page, compiled to WebAssembly (crates/web), on an in-memory
// copy of the demo vault. Like the dev bridge, it routes `invoke` and stubs
// events and native plugins, so the rest of the UI does not know.
//
// Nothing persists: a reload starts again from the demo vault.
declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

type VaultFiles = Record<string, { text: string } | { base64: string }>;

interface Exports {
  memory: WebAssembly.Memory;
  web_alloc(len: number): number;
  web_free(ptr: number, len: number): void;
  web_invoke(cmdPtr: number, cmdLen: number, argsPtr: number, argsLen: number): number;
}

async function load(): Promise<Exports> {
  const { WASI, File, Directory, OpenFile, PreopenDirectory, ConsoleStdout } = await import("@bjorn3/browser_wasi_shim");
  const base = import.meta.env.BASE_URL;
  const [wasm, files] = await Promise.all([
    WebAssembly.compileStreaming(fetch(`${base}synesis.wasm`)),
    fetch(`${base}demo-vault.json`).then((r) => r.json() as Promise<VaultFiles>),
  ]);

  // Unpack the vault into nested directories: the shim wants a tree.
  type Tree = Map<string, InstanceType<typeof File> | Tree>;
  const tree: Tree = new Map();
  for (const [rel, body] of Object.entries(files)) {
    const parts = rel.split("/");
    let dir = tree;
    for (const p of parts.slice(0, -1)) {
      if (!dir.has(p)) dir.set(p, new Map());
      dir = dir.get(p) as Tree;
    }
    const bytes = "text" in body ? new TextEncoder().encode(body.text) : Uint8Array.from(atob(body.base64), (c) => c.charCodeAt(0));
    dir.set(parts[parts.length - 1], new File(bytes));
  }
  const toDir = (t: Tree): Map<string, InstanceType<typeof File> | InstanceType<typeof Directory>> =>
    new Map([...t].map(([k, v]) => [k, v instanceof Map ? new Directory(toDir(v)) : v]));

  const fds = [
    new OpenFile(new File([])),
    ConsoleStdout.lineBuffered((l) => console.log(`[engine] ${l}`)),
    ConsoleStdout.lineBuffered((l) => console.warn(`[engine] ${l}`)),
    new PreopenDirectory("/Demo vault", toDir(tree)),
    new PreopenDirectory("/data", new Map()),
  ];
  const wasi = new WASI([], [], fds, { debug: false });
  const instance = await WebAssembly.instantiate(wasm, { wasi_snapshot_preview1: wasi.wasiImport });
  wasi.initialize(instance as unknown as { exports: { memory: WebAssembly.Memory; _initialize?: () => unknown } });
  return instance.exports as unknown as Exports;
}

function call(e: Exports, cmd: string, args: unknown): unknown {
  const enc = new TextEncoder();
  const put = (s: string): [number, number] => {
    const bytes = enc.encode(s);
    const ptr = e.web_alloc(bytes.length);
    new Uint8Array(e.memory.buffer, ptr, bytes.length).set(bytes);
    return [ptr, bytes.length];
  };
  const [cp, cl] = put(cmd);
  const [ap, al] = put(JSON.stringify(args ?? {}));
  const res = e.web_invoke(cp, cl, ap, al);
  e.web_free(cp, cl);
  e.web_free(ap, al);
  // Memory may have grown during the call: read through a fresh view.
  const view = new DataView(e.memory.buffer);
  const status = view.getUint8(res);
  const len = view.getUint32(res + 1, true);
  const body = new TextDecoder().decode(new Uint8Array(e.memory.buffer, res + 5, len));
  e.web_free(res, 5 + len);
  const value = JSON.parse(body);
  if (status !== 0) throw value;
  return value;
}

if (import.meta.env.MODE === "web" && !("__TAURI_INTERNALS__" in window)) {
  const engine = load();
  engine.catch((e) => console.error("[webengine] failed to load", e));
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
      return call(await engine, cmd, args);
    },
  };
  w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
}

export {};
