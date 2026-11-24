import { describe, expect, it } from "vitest";
import { acceptsDocDrag } from "../docDrag";

const drag = { id: "note-1", composition: "talk-1" };

describe("acceptsDocDrag", () => {
  it("accepts a drag in the editor of the Composition it belongs to", () => {
    expect(acceptsDocDrag(drag, "talk-1", false)).toBe(true);
  });

  it("refuses it in another Composition's editor", () => {
    expect(acceptsDocDrag(drag, "talk-2", false)).toBe(false);
  });

  it("refuses it in an editor that is no Composition's (a Note, a Hub)", () => {
    expect(acceptsDocDrag(drag, undefined, false)).toBe(false);
  });

  it("refuses it while the Composition is read-only (Reading mode)", () => {
    expect(acceptsDocDrag(drag, "talk-1", true)).toBe(false);
  });

  it("refuses a drag it cannot read (another window, malformed data)", () => {
    expect(acceptsDocDrag(null, "talk-1", false)).toBe(false);
  });
});
