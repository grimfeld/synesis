// Bringing a person focused from the keyboard into view (the Family tree).
import { describe, expect, it } from "vitest";
import { revealed } from "../usePanZoom";

describe("revealed", () => {
  const v = { x: 0, y: 0, k: 1 };
  it("leaves the view alone when the box is already in view", () => {
    expect(revealed(v, { x: 100, y: 100, width: 80, height: 36 }, 400, 300)).toBe(v);
  });
  it("pans the least that brings an off-screen box in, with room", () => {
    // Right of the view: its right edge lands 16px from the box's right side.
    expect(revealed(v, { x: 900, y: 100, width: 80, height: 36 }, 400, 300)).toEqual({ x: -596, y: 0, k: 1 });
    // Above and left: its corner lands 16px in.
    expect(revealed(v, { x: -200, y: -50, width: 80, height: 36 }, 400, 300)).toEqual({ x: 216, y: 66, k: 1 });
  });
  it("counts the zoom", () => {
    expect(revealed({ x: 0, y: 0, k: 2 }, { x: 300, y: 0, width: 50, height: 20 }, 400, 300)).toEqual({ x: -316, y: 16, k: 2 });
  });
});
