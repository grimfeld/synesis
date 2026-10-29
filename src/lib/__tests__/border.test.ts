// Drawing a Border on the Map (ADR 0023): the corner list the drawing mode
// edits, before the engine writes it as GeoJSON.
import { describe, expect, it } from "vitest";
import type { Border } from "../api";
import { addCorner, canClose, editableCorners, isRegion } from "../border";

const border = (polygons: Border["polygons"]): Border => ({
  doc: "judah",
  path: "Places/Judah.geojson",
  status: "ok",
  error: null,
  polygons,
});

describe("editableCorners", () => {
  it("gives a drawn Border's corners back without the closing repeat", () => {
    const b = border([[[[1, 1], [1, 2], [2, 2], [1, 1]]]]);
    expect(editableCorners(b)).toEqual([[1, 1], [1, 2], [2, 2]]);
  });

  it("refuses a Border in several pieces or with a hole, which a redraw would lose", () => {
    const square = [[0, 0], [0, 1], [1, 1], [0, 0]] as [number, number][];
    expect(editableCorners(border([[square], [square]]))).toBeNull();
    expect(editableCorners(border([[square, square]]))).toBeNull();
    expect(editableCorners({ ...border([]), status: "malformed" })).toBeNull();
  });
});

describe("addCorner", () => {
  it("adds a corner, and ignores the second click of a double-click on the same spot", () => {
    let c = addCorner([], [1, 1]);
    c = addCorner(c, [1, 2]);
    expect(c).toEqual([[1, 1], [1, 2]]);
    expect(addCorner(c, [1, 2])).toBe(c);
  });
});

describe("canClose", () => {
  it("needs three different corners", () => {
    expect(canClose([[1, 1], [1, 2]])).toBe(false);
    expect(canClose([[1, 1], [1, 2], [1, 1]])).toBe(false);
    expect(canClose([[1, 1], [1, 2], [2, 2]])).toBe(true);
  });
});

describe("isRegion", () => {
  it("is a Place whose kind is region", () => {
    expect(isRegion({ type: "place", kind: "region" })).toBe(true);
    expect(isRegion({ type: "place", kind: " Region " })).toBe(true);
    expect(isRegion({ type: "place", kind: "settlement" })).toBe(false);
    expect(isRegion({ type: "character", kind: "region" })).toBe(false);
  });
});
