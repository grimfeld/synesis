// One live document per id (spec #35, issue #50), Vitest: `npm run test:unit`.
// The engine is a fake that keeps one file per id, like the vault does.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLiveDocuments, type LiveEngine } from "../liveDocument";
import type { DocumentPayload } from "../api";

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
    await settle();
    expect(saves).toEqual([]);
    right.release();
    await settle();
    expect(saves).toEqual([{ id: "a", text: "hello world" }]);
    // Opened again, it is a fresh document read from the file.
    expect(docs.open("a")).not.toBe(left);
  });

  it("notifies subscribers on every change", async () => {
    const { left } = await opened("hello");
    const seen: string[] = [];
    left.subscribe(() => seen.push(left.snapshot().body));
    left.join(() => {}).write("hello!");
    expect(seen.at(-1)).toBe("hello!");
  });
});

describe("an edit from another Window", () => {
  it("reaches every editor here and is not saved again", async () => {
    const { left, saves } = await opened("hello");
    const heard: string[] = [];
    left.join((t) => heard.push(t));
    heard.length = 0;
    left.receive("hello from the other Window");
    expect(heard).toEqual(["hello from the other Window"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(saves).toEqual([]);
  });
});

describe("an edit made in this Window (#51)", () => {
  async function relayed(text: string) {
    const f = fakeEngine({ a: text });
    const sent: { id: string; text: string }[] = [];
    const docs = createLiveDocuments(f.engine, { onEdit: (id, t) => sent.push({ id, text: t }) });
    const d = docs.open("a");
    await d.load();
    return { ...f, docs, d, sent };
  }

  it("is handed on with the whole text, frontmatter included", async () => {
    const { d, sent } = await relayed("---\ntype: note\n---\nhello");
    d.join(() => {}).write("hello world");
    expect(sent).toEqual([{ id: "a", text: "---\ntype: note\n---\nhello world" }]);
    d.editFm("---\ntype: clipping\n---\n");
    expect(sent.at(-1)).toEqual({ id: "a", text: "---\ntype: clipping\n---\nhello world" });
  });

  it("is handed on for a panel's write and a restored Version too", async () => {
    const { d, sent } = await relayed("hello");
    d.setBodyText("linked");
    d.replaceText("restored");
    expect(sent.map((s) => s.text)).toEqual(["linked", "restored"]);
  });

  it("is not handed on when it came from another Window, or when the file is read", async () => {
    const { d, sent } = await relayed("hello");
    d.receive("from elsewhere");
    await d.load();
    expect(sent).toEqual([]);
  });

  it("finds an open document without opening one", async () => {
    const { docs, d } = await relayed("hello");
    expect(docs.peek("a")).toBe(d);
    expect(docs.peek("b")).toBeUndefined();
    d.release();
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
