// The Pane and Window Commands (spec #35, #51): which ones the palette offers,
// and what each does. Vitest: `npm run test:unit`.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/windows", async (orig) => ({
  ...(await orig<typeof import("@/lib/windows")>()),
  openInNewWindow: vi.fn(() => Promise.resolve()),
}));

import { paneCommands } from "@/lib/commands";
import { openInNewWindow } from "@/lib/windows";
import { activePane, initialPanes, panesReducer, type PanesState, type View } from "@/lib/panes";
import { en } from "@/i18n/en";

const doc: View = { kind: "doc", id: "notes/a.md" };
const one = panesReducer(initialPanes(), { type: "open", view: doc });
const two = panesReducer(one, { type: "openInOther", view: { kind: "home" } });

function palette(panes: PanesState, o: { fit?: boolean; windows?: boolean } = {}) {
  const store = {
    twoPanesFit: o.fit ?? true,
    view: activePane(panes).view,
    panes,
    openInOther: vi.fn(),
    dispatchPanes: vi.fn(),
  };
  const list = paneCommands(store, en, o.windows ?? false);
  const run = (id: string) => list.find((c) => c.id === id)!.run();
  return { ids: list.map((c) => c.id), titles: list.map((c) => c.title), run, store };
}

describe("the Pane Commands", () => {
  it("offer Open in other Pane where two fit, opening what the last-used Pane shows", () => {
    const p = palette(one);
    expect(p.ids).toEqual(["pane.open_other"]);
    expect(p.titles).toEqual([en.pane_open_other]);
    p.run("pane.open_other");
    expect(p.store.openInOther).toHaveBeenCalledWith(doc);
    expect(palette(one, { fit: false }).ids).toEqual([]);
  });

  it("offer Close Pane and Swap Panes only with two open", () => {
    const p = palette(two, { fit: false });
    expect(p.ids).toEqual(["pane.close", "pane.swap"]);
    p.run("pane.close");
    p.run("pane.swap");
    expect(p.store.dispatchPanes.mock.calls).toEqual([[{ type: "close" }], [{ type: "swap" }]]);
  });

  it("offer Open in new Window for a document, where there are Windows", () => {
    const p = palette(one, { fit: false, windows: true });
    expect(p.ids).toEqual(["window.open"]);
    p.run("window.open");
    expect(openInNewWindow).toHaveBeenCalledWith("notes/a.md");
    expect(palette(one, { fit: false }).ids).toEqual([]);
    expect(palette(initialPanes(), { fit: false, windows: true }).ids).toEqual([]);
  });
});
