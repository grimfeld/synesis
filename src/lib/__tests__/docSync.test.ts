// Windows typing into the same document at once (spec #35, #51): Vitest,
// `npm run test:unit`. The engine is `FakeEngine`, with its replies delivered
// in random order.
import { describe, expect, it } from "vitest";
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
