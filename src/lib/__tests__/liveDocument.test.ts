// One live document per id (spec #35, issue #50), Vitest: `npm run test:unit`.
// The engine is a fake that keeps one file per id, like the vault does.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLiveDocuments, type LiveEngine } from "../liveDocument";
import type { DocumentPayload } from "../api";
import { FakeEngine, run } from "./fakeWindows";
import { rng } from "./randomText";

function fakeEngine(files: Record<string, string>) {
  const saves: { id: string; text: string }[] = [];
  const payload = (id: string, mtime = 1): DocumentPayload =>
    ({
      summary: { id, title: id, mtime },
      text: files[id],
      frontmatter: {},
      body_offset: 0,
      links: [],
      tags: [],
      references: [],
    }) as unknown as DocumentPayload;
  const engine: LiveEngine = {
    getDocument: async (id) => payload(id),
    saveDocument: async (id, text) => {
      saves.push({ id, text });
      files[id] = text;
      return payload(id, saves.length + 1);
    },
  };
  return { engine, saves, files };
}

/** Let the engine's promises settle, without moving the clock. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function opened(text: string) {
  const f = fakeEngine({ a: text });
  const docs = createLiveDocuments(f.engine);
  const left = docs.open("a");
  const right = docs.open("a");
  await left.load();
  return { ...f, docs, left, right };
}

describe("one live document per id", () => {
  it("gives every opener of an id the same document", async () => {
    const { left, right, docs } = await opened("hello");
    expect(right).toBe(left);
    expect(docs.open("b")).not.toBe(left);
  });

  it("hands an editor's typing to the other editors at once, not back to itself", async () => {
    const { left } = await opened("---\ntype: note\n---\nhello");
    const heardA: string[] = [];
    const heardB: string[] = [];
    const a = left.join((t) => heardA.push(t));
    left.join((t) => heardB.push(t));
    heardA.length = heardB.length = 0;
    a.write("hello world");
    expect(heardB).toEqual(["hello world"]);
    expect(heardA).toEqual([]);
    expect(left.snapshot().body).toBe("hello world");
  });

  it("tells an editor that joins late the text as it stands", async () => {
    const { left } = await opened("hello");
    left.join(() => {}).write("hello there");
    const heard: string[] = [];
    left.join((t) => heard.push(t));
    expect(heard).toEqual(["hello there"]);
  });

  it("saves the edits of both editors once, with the frontmatter kept", async () => {
    const { left, saves } = await opened("---\ntype: note\n---\nhello");
    const a = left.join(() => {});
    const b = left.join(() => {});
    a.write("hello world");
    b.write("hello world, again");
    await vi.advanceTimersByTimeAsync(1000);
    expect(saves).toEqual([{ id: "a", text: "---\ntype: note\n---\nhello world, again" }]);
    expect(left.snapshot().status).toBe("saved");
  });

  it("keeps an edit made while a save is on its way, and saves it after", async () => {
    const { left, saves } = await opened("one");
    const a = left.join(() => {});
    const b = left.join(() => {});
    a.write("one two");
    await vi.advanceTimersByTimeAsync(700);
    // The first save is in flight; the other editor types.
    b.write("one two three");
    await vi.advanceTimersByTimeAsync(1000);
    expect(saves.map((s) => s.text)).toEqual(["one two", "one two three"]);
    expect(left.snapshot().body).toBe("one two three");
  });

  it("does not reload over unsaved typing when a second opener loads", async () => {
    const { left, right } = await opened("hello");
    left.join(() => {}).write("hello world");
    await right.load({ once: true });
    expect(right.snapshot().body).toBe("hello world");
  });

  it("bumps the revision for a wholesale replacement, which every editor follows", async () => {
    const { left, saves } = await opened("hello");
    const r = left.snapshot().revision;
    left.replaceText("---\ntype: note\n---\nrestored");
    expect(left.snapshot().revision).toBe(r + 1);
    expect(left.snapshot().body).toBe("restored");
    await settle();
    expect(saves.at(-1)?.text).toBe("---\ntype: note\n---\nrestored");
  });

  it("flushes pending typing when the last opener closes, not before", async () => {
    const { left, right, saves, docs } = await opened("hello");
    left.join(() => {}).write("hello world");
    left.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(saves).toEqual([]);
    right.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(saves).toEqual([{ id: "a", text: "hello world" }]);
    // Opened again, it is a fresh document read from the file.
    expect(docs.open("a")).not.toBe(left);
  });

  it("is not let go by a release and retain in the same turn (a Strict Mode remount)", async () => {
    const { left, right, saves, docs } = await opened("hello");
    right.release();
    left.write("hello world");
    left.release();
    left.retain();
    await vi.advanceTimersByTimeAsync(0);
    expect(docs.peek("a")).toBe(left);
    expect(saves).toEqual([]);
  });

  it("finds an open document without opening one", async () => {
    const { docs, left, right } = await opened("hello");
    expect(docs.peek("a")).toBe(left);
    expect(docs.peek("b")).toBeUndefined();
    left.release();
    right.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(docs.peek("a")).toBeUndefined();
  });

  it("registers nothing for a document only looked up for a render", () => {
    const f = fakeEngine({ a: "x" });
    const held: string[] = [];
    const docs = createLiveDocuments(f.engine, {
      onOpen: (d) => {
        held.push(d.id);
        return () => {};
      },
    });
    docs.get("a");
    expect(held).toEqual([]);
    docs.get("a").retain();
    expect(held).toEqual(["a"]);
  });

  it("notifies subscribers on every change", async () => {
    const { left } = await opened("hello");
    const seen: string[] = [];
    left.subscribe(() => seen.push(left.snapshot().body));
    left.join(() => {}).write("hello!");
    expect(seen.at(-1)).toBe("hello!");
  });
});

describe("a document held by two Windows (#51)", () => {
  /** Two Windows on one vault: each its own live documents, one engine between them. */
  async function twoWindows(text: string) {
    const f = fakeEngine({ a: text });
    const windows = new FakeEngine();
    const engine: LiveEngine = {
      getDocument: f.engine.getDocument,
      // The Tauri command tells the sessions what it wrote (`save_document`).
      saveDocument: async (id, t) => {
        const d = await f.engine.saveDocument(id, t);
        windows.saved(id, t);
        return d;
      },
    };
    const main = createLiveDocuments(engine, { sync: windows.transport("main") });
    const other = createLiveDocuments(engine, { sync: windows.transport("doc-1") });
    windows.pokes.set("main", (id) => main.peek(id)?.poke());
    windows.pokes.set("doc-1", (id) => other.peek(id)?.poke());
    const a = main.open("a");
    const b = other.open("a");
    const loaded = Promise.all([a.load({ once: true }), b.load({ once: true })]);
    await run(windows);
    await loaded;
    return { ...f, windows, main, other, a, b };
  }

  it("keeps every keystroke typed in both at the same instant", async () => {
    const r = rng(7);
    const { windows, a, b } = await twoWindows("---\ntype: note\n---\n");
    const ea = a.join(() => {});
    const eb = b.join(() => {});
    const typed: string[] = [];
    for (let i = 0; i < 50; i++) {
      const [d, e] = r() < 0.5 ? [a, ea] : [b, eb];
      const ch = String.fromCharCode(0x4e00 + i);
      typed.push(ch);
      const body = d.snapshot().body;
      const at = Math.floor(r() * (body.length + 1));
      e.write(body.slice(0, at) + ch + body.slice(at));
      if (r() < 0.5) {
        await settle();
        windows.step(r);
      }
    }
    await run(windows, r);
    expect(a.snapshot().body).toBe(b.snapshot().body);
    expect([...a.snapshot().body].sort()).toEqual(typed.sort());
    expect(a.snapshot().fm).toBe("---\ntype: note\n---\n");
  });

  it("hands each editor the other Window's typing as it comes", async () => {
    const { windows, a, b } = await twoWindows("hello");
    const heard: string[] = [];
    b.join((t) => heard.push(t));
    a.join(() => {}).write("hello world");
    await run(windows);
    expect(heard.at(-1)).toBe("hello world");
  });

  it("saves the merged text whichever Window saves last", async () => {
    const { windows, a, b, files } = await twoWindows("one");
    a.join(() => {}).write("one two");
    b.join(() => {}).write("zero one");
    await run(windows);
    await vi.advanceTimersByTimeAsync(1000);
    await run(windows);
    await vi.advanceTimersByTimeAsync(1000);
    expect(a.snapshot().body).toBe("zero one two");
    expect(files.a).toBe("zero one two");
  });

  it("sends and saves a closing Window's last typing first", async () => {
    const { windows, a, b, files } = await twoWindows("one");
    a.join(() => {}).write("one two");
    // The Window closes before the debounce or the engine answered.
    const flushed = a.flush();
    await run(windows);
    await flushed;
    expect(files.a).toBe("one two");
    expect(b.snapshot().body).toBe("one two");
  });

  it("takes the other Window's save as nothing new", async () => {
    const { windows, a, b, files } = await twoWindows("one");
    a.join(() => {}).write("one two");
    await run(windows);
    const flushed = a.flush();
    await run(windows);
    await flushed;
    b.noticeChange([{ id: "a", mtime: 99 }]);
    await run(windows);
    expect(files.a).toBe("one two");
    expect(b.snapshot().external).toBe(false);
    expect(b.snapshot().body).toBe("one two");
  });

  it("takes an edit made outside the app in both", async () => {
    const { windows, a, b, files } = await twoWindows("one");
    files.a = "from Obsidian";
    a.noticeChange([{ id: "a", mtime: 99 }]);
    b.noticeChange([{ id: "a", mtime: 99 }]);
    await run(windows);
    expect(a.snapshot().body).toBe("from Obsidian");
    expect(b.snapshot().body).toBe("from Obsidian");
    expect(a.snapshot().external || b.snapshot().external).toBe(false);
  });
});

describe("saving", () => {
  it("is announced to every listener, with the id", async () => {
    const f = fakeEngine({ a: "x" });
    const docs = createLiveDocuments(f.engine);
    const heard: string[] = [];
    docs.onSaved((id) => heard.push(id));
    const d = docs.open("a");
    await d.load();
    d.write("xy");
    await vi.advanceTimersByTimeAsync(1000);
    expect(heard).toEqual(["a"]);
  });

  it("waits for a save already on its way before saving what came after", async () => {
    const { left, saves } = await opened("one");
    left.write("one two");
    await vi.advanceTimersByTimeAsync(700); // a save is in flight
    left.write("one two three");
    await left.flush();
    expect(saves.at(-1)?.text).toBe("one two three");
  });

  it("normalises line breaks in a restored Version like a read does", async () => {
    const { left } = await opened("hello");
    left.replaceText("---\r\ntype: note\r\n---\r\nline one\r\nline two");
    expect(left.snapshot().body).toBe("line one\nline two");
  });
});

describe("a Vault change", () => {
  it("saves what is pending, then writes nothing more", async () => {
    const { left, saves, docs } = await opened("hello");
    left.write("hello world");
    await docs.suspend();
    expect(saves.map((s) => s.text)).toEqual(["hello world"]);
    // A late keystroke or the unmount's release lands nowhere.
    left.write("into the new vault");
    left.release();
    left.release();
    await vi.advanceTimersByTimeAsync(2000);
    expect(saves.length).toBe(1);
    expect(docs.peek("a")).toBeUndefined();
  });
});

describe("a change on disk", () => {
  it("reloads when nothing is pending, and warns instead when there is typing", async () => {
    const { left, files } = await opened("hello");
    files.a = "from elsewhere";
    left.noticeChange([{ id: "a", mtime: 99 }]);
    await settle();
    expect(left.snapshot().body).toBe("from elsewhere");
    left.join(() => {}).write("mine");
    files.a = "elsewhere again";
    left.noticeChange([{ id: "a", mtime: 100 }]);
    await settle();
    expect(left.snapshot().body).toBe("mine");
    expect(left.snapshot().external).toBe(true);
  });
});
