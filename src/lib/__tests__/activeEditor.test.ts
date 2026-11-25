// Which editor Commands act on (spec #206): the Writing page's, unless an
// editor that is active only while focused (a capture box) has taken focus.
import { describe, expect, it, vi } from "vitest";
import { createActiveEditor } from "../activeEditor";

describe("createActiveEditor", () => {
  it("is empty until an editor registers", () => {
    const r = createActiveEditor<string>();
    expect(r.active()).toBeNull();
  });

  it("acts on the registered Writing page, the last one registered winning", () => {
    const r = createActiveEditor<string>();
    r.register("left");
    expect(r.active()).toBe("left");
    r.register("right");
    expect(r.active()).toBe("right");
    // The left Pane unregistering late does not take the right one's place away.
    r.release("left");
    expect(r.active()).toBe("right");
    r.release("right");
    expect(r.active()).toBeNull();
  });

  it("acts on a box while it has focus, then goes back to the Writing page on blur", () => {
    const r = createActiveEditor<string>();
    r.register("page");
    r.focus("box");
    expect(r.active()).toBe("box");
    r.blur("box", { kept: false });
    expect(r.active()).toBe("page");
  });

  it("acts on the editor that last took focus when two boxes are mounted", () => {
    const r = createActiveEditor<string>();
    r.register("page");
    r.focus("a");
    r.focus("b");
    expect(r.active()).toBe("b");
    // a's blur arrives after b took over: it must not take b's claim away.
    r.blur("a", { kept: false });
    expect(r.active()).toBe("b");
  });

  it("keeps the box while focus is in the Command palette, so a Command run from it hits the box", () => {
    const r = createActiveEditor<string>();
    r.register("page");
    r.focus("box");
    r.blur("box", { kept: true });
    expect(r.active()).toBe("box");
    // The palette closes and the Command focuses the box again.
    r.focus("box");
    expect(r.active()).toBe("box");
  });

  it("drops a kept box once focus lands anywhere else", () => {
    const r = createActiveEditor<string>();
    r.register("page");
    r.focus("box");
    r.blur("box", { kept: true });
    r.focusElsewhere();
    expect(r.active()).toBe("page");
  });

  it("drops a kept box when the palette closes with focus falling to the body", () => {
    const r = createActiveEditor<string>();
    r.register("page");
    r.focus("box");
    r.blur("box", { kept: true });
    // No focusin anywhere: only the palette closing says the keep is over.
    r.keepEnded();
    expect(r.active()).toBe("page");
    expect(r.boxActive()).toBe(false);
  });

  it("keeps a box that took focus back before the palette's close was handled", () => {
    const r = createActiveEditor<string>();
    r.register("page");
    r.focus("box");
    r.blur("box", { kept: true });
    // The Command focused the box again (bold), then the close is handled.
    r.focus("box");
    r.keepEnded();
    expect(r.active()).toBe("box");
  });

  it("ignores focus landing elsewhere while the box itself has focus", () => {
    const r = createActiveEditor<string>();
    r.focus("box");
    // Only a box that has lost focus can be dropped this way.
    r.focusElsewhere();
    expect(r.active()).toBe("box");
  });

  it("forgets a box that unmounts, focused or kept", () => {
    const r = createActiveEditor<string>();
    r.register("page");
    r.focus("box");
    r.release("box");
    expect(r.active()).toBe("page");
    r.focus("box2");
    r.blur("box2", { kept: true });
    r.release("box2");
    expect(r.active()).toBe("page");
  });

  it("a Writing page registering does not take a focused box's place", () => {
    const r = createActiveEditor<string>();
    r.focus("box");
    r.register("page");
    expect(r.active()).toBe("box");
  });

  it("tells subscribers only when the active editor changes", () => {
    const r = createActiveEditor<string>();
    const l = vi.fn();
    const off = r.subscribe(l);
    r.register("page");
    expect(l).toHaveBeenCalledTimes(1);
    r.register("page");
    r.blur("box", { kept: false });
    r.focusElsewhere();
    expect(l).toHaveBeenCalledTimes(1);
    r.focus("box");
    expect(l).toHaveBeenCalledTimes(2);
    off();
    r.blur("box", { kept: false });
    expect(l).toHaveBeenCalledTimes(2);
  });

  it("says whether the active editor is a box, which Reading mode does not lock", () => {
    const r = createActiveEditor<string>();
    r.register("page");
    expect(r.boxActive()).toBe(false);
    r.focus("box");
    expect(r.boxActive()).toBe(true);
    r.blur("box", { kept: true });
    expect(r.boxActive()).toBe(true);
    r.focusElsewhere();
    expect(r.boxActive()).toBe(false);
  });
});
