import { afterEach, describe, expect, it } from "vitest";
import {
  acceptsDocDrag,
  activeDocDrag,
  DOC_DRAG_TYPE,
  droppedDocDrag,
  endDocDrag,
  isDocDrag,
  writeDocDrag,
} from "../docDrag";

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

/** A DataTransfer as far as the drag uses it (jsdom has none). */
function transfer(): DataTransfer {
  const data = new Map<string, string>();
  return {
    effectAllowed: "none",
    get types() {
      return [...data.keys()];
    },
    setData: (k: string, v: string) => void data.set(k, v),
    getData: (k: string) => data.get(k) ?? "",
  } as unknown as DataTransfer;
}

describe("droppedDocDrag", () => {
  afterEach(() => endDocDrag());

  it("takes the drop of the drag this window started", () => {
    const dt = transfer();
    writeDocDrag(dt, drag);
    expect(droppedDocDrag(dt)).toEqual(drag);
  });

  it("takes nothing from a payload with no drag in progress here", () => {
    const dt = transfer();
    dt.setData(DOC_DRAG_TYPE, JSON.stringify(drag));
    expect(isDocDrag(dt)).toBe(true);
    expect(droppedDocDrag(dt)).toBeNull();
  });

  it("takes nothing when the payload names another document or Composition", () => {
    writeDocDrag(transfer(), drag);
    const other = transfer();
    other.setData(DOC_DRAG_TYPE, JSON.stringify({ ...drag, id: "note-2" }));
    expect(droppedDocDrag(other)).toBeNull();
    other.setData(DOC_DRAG_TYPE, JSON.stringify({ ...drag, composition: "talk-2" }));
    expect(droppedDocDrag(other)).toBeNull();
  });

  it("forgets the drag once the window hears it end, wherever the row went", () => {
    const dt = transfer();
    writeDocDrag(dt, drag);
    window.dispatchEvent(new Event("dragend"));
    expect(activeDocDrag()).toBeNull();
    expect(droppedDocDrag(dt)).toBeNull();
  });
});
