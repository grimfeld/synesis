// Windows typing into the same document at once (spec #35, #51): Vitest,
// `npm run test:unit`. The engine is `FakeEngine`, with its replies delivered
// in random order.
import { describe, expect, it, vi } from "vitest";
import { DocSync } from "../docSync";
import { FakeEngine, run, settle } from "./fakeWindows";
import { randomEdit, rng } from "./randomText";

/** A Window showing one document: its text, kept in step by a DocSync. */
function windowOn(engine: FakeEngine, label: string, id = "a") {
  const w = {
    text: "",
    sync: null as unknown as DocSync,
    /** Typing here. */
    type(next: string) {
      const before = w.text;
      w.text = next;
      w.sync.local(before, next);
    },
  };
  w.sync = new DocSync(id, engine.transport(label), {
    text: () => w.text,
    remote: (t) => {
      w.text = t;
    },
  });
  engine.pokes.set(label, () => w.sync.poke());
  return w;
}

async function twoWindows(text: string) {
  const engine = new FakeEngine();
  const a = windowOn(engine, "main");
  const b = windowOn(engine, "doc-1");
  a.text = b.text = text;
  const joined = Promise.all([a.sync.join(text), b.sync.join(text)]);
  await run(engine);
  await joined;
  return { engine, a, b };
}

describe("two Windows on one document", () => {
  it("show a newcomer the typing the other has not saved yet", async () => {
    const engine = new FakeEngine();
    const a = windowOn(engine, "main");
    a.text = "one";
    const j = a.sync.join("one");
    await run(engine);
    await j;
    a.type("one two");
    await run(engine);
    // The second Window reads the file, which still says "one".
    const b = windowOn(engine, "doc-1");
    b.text = "one";
    const j2 = b.sync.join("one");
    await run(engine);
    await j2;
    expect(b.text).toBe("one two");
  });

  it("keep every keystroke of both when they type at the same instant", async () => {
    for (let seed = 1; seed <= 40; seed++) {
      const r = rng(seed);
      const { engine, a, b } = await twoWindows("");
      const typed: string[] = [];
      let n = 0;
      for (let i = 0; i < 60; i++) {
        const w = r() < 0.5 ? a : b;
        // Each keystroke is a character used once, so a lost one shows.
        const ch = String.fromCharCode(0x4e00 + n++);
        typed.push(ch);
        const at = Math.floor(r() * (w.text.length + 1));
        w.type(w.text.slice(0, at) + ch + w.text.slice(at));
        // Some replies land between keystrokes, in any order; some wait.
        for (let k = Math.floor(r() * 3); k > 0; k--) {
          await settle();
          engine.step(r);
        }
      }
      await run(engine, r);
      expect(a.text).toBe(b.text);
      expect([...a.text].sort()).toEqual(typed.sort());
    }
  });

  it("end on the same text through deletes and replacements too", async () => {
    for (let seed = 100; seed < 130; seed++) {
      const r = rng(seed);
      const { engine, a, b } = await twoWindows("the word was with God");
      for (let i = 0; i < 40; i++) {
        const w = r() < 0.5 ? a : b;
        w.type(randomEdit(w.text, r));
        for (let k = Math.floor(r() * 3); k > 0; k--) {
          await settle();
          engine.step(r);
        }
      }
      await run(engine, r);
      expect(a.text).toBe(b.text);
      expect(engine.sessions.get("a")!.text).toBe(a.text);
    }
  });

  it("drain once the engine has taken every change", async () => {
    const { engine, a } = await twoWindows("x");
    a.type("xy");
    let drained = false;
    void a.sync.drain().then(() => (drained = true));
    await settle();
    expect(drained).toBe(false);
    expect(a.sync.pending()).toBe(true);
    await run(engine);
    expect(drained).toBe(true);
    expect(engine.sessions.get("a")!.text).toBe("xy");
  });
});

describe("the file changing under two Windows", () => {
  it("is the echo of a Window's own save, which changes nothing", async () => {
    const { engine, a, b } = await twoWindows("one");
    a.type("one two");
    await run(engine);
    engine.saved("a", "one two");
    b.type("one two three");
    const r = b.sync.disk("one two", false);
    await run(engine);
    expect(await r).toEqual({ external: false });
    expect(a.text).toBe("one two three");
    expect(b.text).toBe("one two three");
  });

  it("is taken by both when everything was saved, keeping typing not sent yet", async () => {
    const { engine, a, b } = await twoWindows("one");
    a.type("one!"); // not delivered yet
    const r = b.sync.disk("ONE", false);
    // The file's change reaches the engine before a's typing does.
    engine.step(() => 0.99);
    await run(engine);
    expect(await r).toEqual({ external: false });
    expect(a.text).toBe("ONE!");
    expect(b.text).toBe("ONE!");
  });

  it("is shown, not taken, over typing not saved", async () => {
    const { engine, a, b } = await twoWindows("one");
    a.type("one two");
    await run(engine);
    const r = b.sync.disk("uno", false);
    await run(engine);
    expect(await r).toEqual({ external: true });
    expect(b.text).toBe("one two");
  });
});

describe("a Window that cannot or no longer syncs", () => {
  const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});

  it("keeps its own text when it cannot join, and sends nothing", async () => {
    quiet();
    const refused = () => Promise.reject(new Error("no engine"));
    const lone = new DocSync("a", { join: refused, sync: refused, leave: refused }, {
      text: () => "mine",
      remote: () => {},
    });
    await lone.join("mine");
    expect(lone.active).toBe(false);
    lone.local("mine", "mine!");
    expect(lone.pending()).toBe(false);
    expect(await lone.disk("theirs", false)).toEqual({ external: false });
    await lone.drain();
  });

  it("does not join when it left while joining", async () => {
    const engine = new FakeEngine();
    const w = windowOn(engine, "main");
    const joining = w.sync.join("x");
    w.sync.leave();
    await run(engine);
    await joining;
    expect(w.sync.active).toBe(false);
    // The engine took the join; the Window takes it back, and never sends on it.
    expect(engine.sessions.get("a")?.members.size ?? 0).toBe(0);
    w.type("xy");
    await run(engine);
    expect(engine.queue).toHaveLength(0);
  });

  it("joins once, however often it is asked", async () => {
    const engine = new FakeEngine();
    const w = windowOn(engine, "main");
    const first = w.sync.join("x");
    void w.sync.join("x");
    await run(engine);
    await first;
    void w.sync.join("x");
    expect(engine.queue).toHaveLength(0);
  });

  it("leaves the session, so the other Window's typing no longer reaches it", async () => {
    const { engine, a, b } = await twoWindows("x");
    b.sync.leave();
    b.sync.leave();
    await run(engine);
    expect([...engine.sessions.get("a")!.members.keys()]).toEqual([`main/${a.sync.client}`]);
    a.type("xa");
    await run(engine);
    expect(b.text).toBe("x");
    expect(b.sync.active).toBe(false);
  });

  it("answers a file read waiting to be sent when it leaves", async () => {
    const { a } = await twoWindows("x");
    a.type("xy"); // busy with this change
    const r = a.sync.disk("file", false);
    a.sync.leave();
    expect(await r).toEqual({ external: false });
    expect(a.sync.pending()).toBe(false);
  });

  it("stops syncing when the engine refuses a change, and keeps its text", async () => {
    quiet();
    const { engine, a } = await twoWindows("x");
    engine.sessions.delete("a"); // the Vault changed
    const r = a.sync.disk("file", false);
    await run(engine);
    expect(await r).toEqual({ external: false });
    expect(a.sync.active).toBe(false);
    a.type("xy");
    expect(a.sync.pending()).toBe(false);
    expect(a.text).toBe("xy");
  });

  it("answers a file read sent before it left without taking the reply", async () => {
    const { engine, a, b } = await twoWindows("one");
    const r = b.sync.disk("ONE", false);
    b.sync.leave();
    await run(engine);
    expect(await r).toEqual({ external: false });
    expect(b.text).toBe("one");
    expect(a.text).toBe("ONE");
  });
});

describe("what a Window sends, and when", () => {
  it("asks the engine to join once, even when asked again while joining", async () => {
    const engine = new FakeEngine();
    const joins = vi.spyOn(engine, "join");
    const w = windowOn(engine, "main");
    const first = w.sync.join("x");
    const second = w.sync.join("x");
    await run(engine);
    await Promise.all([first, second]);
    expect(joins).toHaveBeenCalledTimes(1);
  });

  it("sends nothing typed before it joins, and answers a file read at once", async () => {
    const engine = new FakeEngine();
    const w = windowOn(engine, "main");
    w.type("typed");
    expect(w.sync.pending()).toBe(false);
    expect(await w.sync.disk("file", false)).toEqual({ external: false });
    expect(engine.queue).toHaveLength(0);
  });

  it("hands a newcomer the others' typing as a change still to save", async () => {
    const engine = new FakeEngine();
    const a = windowOn(engine, "main");
    a.text = "one";
    const ja = a.sync.join("one");
    await run(engine);
    await ja;
    a.type("one two");
    await run(engine);
    const heard: { text: string; disk: boolean }[] = [];
    const b = new DocSync("a", engine.transport("doc-1"), {
      text: () => "one",
      remote: (text, disk) => heard.push({ text, disk }),
    });
    const jb = b.join("one");
    await run(engine);
    await jb;
    expect(heard).toEqual([{ text: "one two", disk: false }]);
  });

  it("is not done while a file read is on its way to the engine", async () => {
    const { engine, a } = await twoWindows("x");
    void a.sync.disk("x!", true);
    let drained = false;
    void a.sync.drain().then(() => (drained = true));
    await settle();
    expect(drained).toBe(false);
    await run(engine);
    expect(drained).toBe(true);
  });

  it("asks nothing more of the engine once it left, even when told of a change", async () => {
    const { engine, a } = await twoWindows("x");
    a.sync.leave();
    await run(engine);
    a.sync.poke();
    expect(engine.queue).toHaveLength(0);
  });

  it("drops the answer to a change sent before it left", async () => {
    const { engine, a, b } = await twoWindows("x");
    a.type("xy");
    a.sync.leave();
    await run(engine);
    expect(a.sync.pending()).toBe(false);
    expect(b.text).toBe("xy");
  });

  it("stops when the engine refuses a typed change", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { engine, a } = await twoWindows("x");
    engine.sessions.delete("a");
    a.type("xy");
    await run(engine);
    expect(a.sync.active).toBe(false);
    expect(a.text).toBe("xy");
  });
});
