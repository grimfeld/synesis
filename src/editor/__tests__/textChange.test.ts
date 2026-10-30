// The smallest change from one text to another, so an edit made in the
// other Pane leaves this one's caret where it was (issue #50).
import { describe, expect, it } from "vitest";
import { textChange } from "../textChange";

const apply = (a: string, c: ReturnType<typeof textChange>) =>
  c ? a.slice(0, c.from) + c.insert + a.slice(c.to) : a;

describe("textChange", () => {
  it("is null for equal texts", () => {
    expect(textChange("abc", "abc")).toBeNull();
  });

  it("covers only what was typed", () => {
    expect(textChange("hello world", "hello brave world")).toEqual({ from: 6, to: 6, insert: "brave " });
  });

  it("covers only what was deleted", () => {
    // "one t|wo t|hree": the common start runs into the "t" of "three".
    expect(textChange("one two three", "one three")).toEqual({ from: 5, to: 9, insert: "" });
  });

  it("does not let prefix and suffix overlap in a repeated run", () => {
    const c = textChange("aaa", "aaaa");
    expect(apply("aaa", c)).toBe("aaaa");
    expect(c!.to - c!.from).toBe(0);
  });

  it("never splits a surrogate pair", () => {
    const a = "x\u{1F600}y";
    const b = "x\u{1F601}y";
    const c = textChange(a, b)!;
    expect(apply(a, c)).toBe(b);
    expect(c).toEqual({ from: 1, to: 3, insert: "\u{1F601}" });
  });
});
