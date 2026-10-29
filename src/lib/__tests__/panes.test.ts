// The Pane model (Vitest, jsdom): `npm run test:unit`.
import { describe, expect, it } from "vitest";
import {
  initialPanes,
  panesReducer,
  restoreLayout,
  savedLayout,
  shownPanes,
  type PaneAction,
  type PanesState,
} from "../panes";

const doc = (id: string) => ({ kind: "doc", id }) as const;

function run(...actions: PaneAction[]): PanesState {
  return actions.reduce(panesReducer, initialPanes());
}

describe("open", () => {
  it("starts on Home in a single Pane", () => {
    const s = initialPanes();
    expect(s.panes).toHaveLength(1);
    expect(s.panes[0].view).toEqual({ kind: "home" });
    expect(s.lastUsed).toBe(0);
  });

  it("opens in the last-used Pane and Back returns", () => {
    const s = run({ type: "open", view: doc("a") }, { type: "open", view: doc("b") }, { type: "back" });
    expect(s.panes[0].view).toEqual(doc("a"));
  });
});

describe("forward", () => {
  it("returns to where Back came from, and a new open clears it", () => {
    const s = run({ type: "open", view: doc("a") }, { type: "back" }, { type: "forward" });
    expect(s.panes[0].view).toEqual(doc("a"));
    const t = run({ type: "open", view: doc("a") }, { type: "back" }, { type: "open", view: doc("b") }, { type: "forward" });
    expect(t.panes[0].view).toEqual(doc("b"));
  });
});

describe("openInOther", () => {
  it("opens a second Pane from a single one and uses it", () => {
    const s = run({ type: "open", view: doc("a") }, { type: "openInOther", view: doc("b") });
    expect(s.panes.map((p) => p.view)).toEqual([doc("a"), doc("b")]);
    expect(s.lastUsed).toBe(1);
    expect(s.panes[1]?.back).toEqual([]);
  });

  it("with two Panes, opens in the one not last used", () => {
    const s = run(
      { type: "openInOther", view: doc("b") },
      { type: "openInOther", view: doc("c") },
    );
    expect(s.panes.map((p) => p.view)).toEqual([doc("c"), doc("b")]);
    expect(s.lastUsed).toBe(0);
    expect(s.panes[0].back).toEqual([{ kind: "home" }]);
  });
});

describe("per-Pane history", () => {
  // Left: home → a → b. Right: c → d. Last used: the right.
  const twoPanes = [
    { type: "open", view: doc("a") },
    { type: "open", view: doc("b") },
    { type: "openInOther", view: doc("c") },
    { type: "open", view: doc("d") },
  ] satisfies PaneAction[];

  it("Back moves only the last-used Pane", () => {
    const s = run(...twoPanes, { type: "back" });
    expect(s.panes.map((p) => p.view)).toEqual([doc("b"), doc("c")]);
  });

  it("Back follows focus to the other Pane", () => {
    const s = run(...twoPanes, { type: "focus", pane: 0 }, { type: "back" }, { type: "back" });
    expect(s.panes.map((p) => p.view)).toEqual([{ kind: "home" }, doc("d")]);
    expect(run(...twoPanes, { type: "focus", pane: 0 }, { type: "back" }, { type: "forward" }).panes[0].view).toEqual(doc("b"));
  });
});

describe("focus", () => {
  it("sets the last-used Pane", () => {
    const s = run({ type: "openInOther", view: doc("b") }, { type: "focus", pane: 0 });
    expect(s.lastUsed).toBe(0);
  });

  it("ignores a Pane that is not open", () => {
    expect(run({ type: "focus", pane: 1 }).lastUsed).toBe(0);
  });
});

describe("close", () => {
  it("closes the last-used Pane and keeps the other, with its history", () => {
    const s = run({ type: "open", view: doc("a") }, { type: "openInOther", view: doc("b") }, { type: "close" });
    expect(s.panes).toHaveLength(1);
    expect(s.panes[0].view).toEqual(doc("a"));
    expect(s.panes[0].back).toEqual([{ kind: "home" }]);
    expect(s.lastUsed).toBe(0);
  });

  it("closes a named Pane", () => {
    const s = run({ type: "open", view: doc("a") }, { type: "openInOther", view: doc("b") }, { type: "close", pane: 0 });
    expect(s.panes.map((p) => p.view)).toEqual([doc("b")]);
    expect(s.lastUsed).toBe(0);
  });

  it("never closes the last Pane", () => {
    const s = run({ type: "open", view: doc("a") }, { type: "close" });
    expect(s.panes.map((p) => p.view)).toEqual([doc("a")]);
  });
});

describe("talk and Board, per Pane", () => {
  it("sets the face and the split ratio of the last-used Pane only", () => {
    const s = run(
      { type: "openInOther", view: doc("b") },
      { type: "setDocTab", tab: "split" },
      { type: "setSplitRatio", ratio: 0.3 },
    );
    expect(s.panes[1]).toMatchObject({ docTab: "split", splitRatio: 0.3 });
    expect(s.panes[0]).toMatchObject({ docTab: "talk", splitRatio: 0.5 });
  });

  it("keeps the face across navigation, as the single split did", () => {
    const s = run({ type: "setDocTab", tab: "split" }, { type: "open", view: doc("a") });
    expect(s.panes[0].docTab).toBe("split");
  });
});

describe("reset", () => {
  it("returns to a single Pane on Home with no history", () => {
    const s = run({ type: "open", view: doc("a") }, { type: "openInOther", view: doc("b") }, { type: "reset" });
    expect(s).toEqual(initialPanes());
  });
});

describe("history limit", () => {
  it("keeps the last 50 views", () => {
    const opens = Array.from({ length: 60 }, (_, i) => ({ type: "open", view: doc(`d${i}`) }) as PaneAction);
    const s = run(...opens);
    expect(s.panes[0].back).toHaveLength(50);
    expect(s.panes[0].back[49]).toEqual(doc("d58"));
  });
});

describe("shownPanes", () => {
  const two = run({ type: "open", view: doc("a") }, { type: "openInOther", view: doc("b") });

  it("shows both Panes when each fits its minimum", () => {
    expect(shownPanes(two, 1280)).toEqual([0, 1]);
  });

  it("collapses to the last-used Pane when narrow, keeping the other", () => {
    expect(shownPanes(two, 375)).toEqual([1]);
    expect(shownPanes(panesReducer(two, { type: "focus", pane: 0 }), 375)).toEqual([0]);
    expect(two.panes).toHaveLength(2);
  });

  it("shows a single Pane at any width", () => {
    expect(shownPanes(initialPanes(), 375)).toEqual([0]);
    expect(shownPanes(initialPanes(), 1280)).toEqual([0]);
  });
});

describe("swap", () => {
  it("swaps the sides, and the last-used Pane moves with its document", () => {
    const s = run({ type: "open", view: doc("a") }, { type: "openInOther", view: doc("b") }, { type: "swap" });
    expect(s.panes.map((p) => p.view)).toEqual([doc("b"), doc("a")]);
    expect(s.lastUsed).toBe(0);
  });

  it("does nothing with one Pane", () => {
    const s = run({ type: "open", view: doc("a") });
    expect(panesReducer(s, { type: "swap" })).toBe(s);
  });
});

describe("the divider between Panes", () => {
  it("starts half and half and moves", () => {
    expect(initialPanes().ratio).toBe(0.5);
    expect(run({ type: "setRatio", ratio: 0.3 }).ratio).toBe(0.3);
  });

  it("keeps each document's width when the Panes swap", () => {
    const s = run({ type: "openInOther", view: doc("b") }, { type: "setRatio", ratio: 0.3 }, { type: "swap" });
    expect(s.ratio).toBeCloseTo(0.7);
  });
});

describe("saving and restoring the layout", () => {
  const all = () => true;

  it("saves nothing with a single Pane, so the app opens on Home", () => {
    expect(savedLayout(run({ type: "open", view: doc("a") }))).toBeNull();
  });

  it("restores both Panes, the last-used one and the divider, without history", () => {
    const s = run(
      { type: "open", view: doc("a") },
      { type: "openInOther", view: doc("b") },
      { type: "setRatio", ratio: 0.4 },
      { type: "focus", pane: 0 },
    );
    const back = restoreLayout(JSON.parse(JSON.stringify(savedLayout(s))), all);
    expect(back?.panes.map((p) => p.view)).toEqual([doc("a"), doc("b")]);
    expect(back?.panes[0].back).toEqual([]);
    expect(back?.lastUsed).toBe(0);
    expect(back?.ratio).toBe(0.4);
  });

  it("opens Home in place of a document that is gone", () => {
    const s = run({ type: "open", view: doc("a") }, { type: "openInOther", view: { kind: "graph", focus: "b" } });
    const back = restoreLayout(savedLayout(s), (id) => id === "a");
    expect(back?.panes.map((p) => p.view)).toEqual([doc("a"), { kind: "home" }]);
  });

  it("ignores anything that is not a saved layout", () => {
    for (const raw of [null, "x", {}, { views: [doc("a")] }, { views: [{ kind: "nope" }, doc("a")], lastUsed: 0, ratio: 0.5 }])
      expect(restoreLayout(raw, all)).toBeNull();
  });

  it("keeps a broken divider or last-used Pane in range", () => {
    const back = restoreLayout({ views: [doc("a"), doc("b")], lastUsed: 7, ratio: "wide" }, all);
    expect(back?.lastUsed).toBe(0);
    expect(back?.ratio).toBe(0.5);
  });
});

describe("acting on a named Pane", () => {
  const two = run({ type: "open", view: doc("a") }, { type: "openInOther", view: doc("b") });

  it("goes back in that Pane without moving the last-used one", () => {
    const s = panesReducer(two, { type: "back", pane: 0 });
    expect(s.panes.map((p) => p.view)).toEqual([{ kind: "home" }, doc("b")]);
    expect(s.lastUsed).toBe(1);
  });

  it("sets that Pane's face", () => {
    const s = panesReducer(two, { type: "setDocTab", tab: "split", pane: 0 });
    expect(s.panes[0].docTab).toBe("split");
    expect(s.panes[1]?.docTab).toBe("talk");
  });
});
