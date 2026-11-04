// Text operations (spec #35): Vitest, `npm run test:unit`.
import { describe, expect, it } from "vitest";
import { apply, compose, diff, transform, type Op } from "../textOp";
import { randomEdit, rng } from "./randomText";

describe("a text operation", () => {
  it("applies, keeping, deleting and inserting", () => {
    expect(apply([2, "X", -1, 1], "abcd")).toBe("abXd");
    expect(() => apply([5], "abc")).toThrow();
  });

  it("is the smallest single change between two texts", () => {
    expect(diff("hello", "help")).toEqual([3, "p", -2]);
    expect(diff("same", "same")).toBeNull();
    expect(apply(diff("say 😀", "say 😃")!, "say 😀")).toBe("say 😃");
  });

  it("composes typing into one operation", () => {
    const r = rng(1);
    for (let i = 0; i < 300; i++) {
      const a = "the quick brown fox";
      const b = randomEdit(a, r);
      const c = randomEdit(b, r);
      const ab = diff(a, b) ?? [a.length];
      const bc = diff(b, c) ?? [b.length];
      expect(apply(compose(ab, bc), a)).toBe(c);
    }
  });

  it("rebases two concurrent operations onto the same text", () => {
    const r = rng(2);
    for (let i = 0; i < 500; i++) {
      const t = "in the beginning was the word";
      const a = diff(t, randomEdit(t, r)) ?? [t.length];
      const b = diff(t, randomEdit(t, r)) ?? [t.length];
      const [a2, b2] = transform(a, b);
      expect(apply(b2, apply(a, t))).toBe(apply(a2, apply(b, t)));
    }
  });

  it("keeps both inserts at the same place, the first operation's first", () => {
    const a: Op = [2, "A", 2];
    const b: Op = [2, "B", 2];
    const [a2, b2] = transform(a, b);
    expect(apply(b2, apply(a, "abcd"))).toBe("abABcd");
    expect(apply(a2, apply(b, "abcd"))).toBe("abABcd");
  });

  it("keeps an insert made inside a range the other deleted", () => {
    const t = "0123456789";
    const del: Op = [2, -6, 2]; // deletes 234567
    const ins: Op = [5, "keep", 5];
    const [d2, i2] = transform(del, ins);
    expect(apply(i2, apply(del, t))).toBe("01keep89");
    expect(apply(d2, apply(ins, t))).toBe("01keep89");
  });

  it("folds keystrokes typed one by one into one compact change", () => {
    let text = "ab";
    let op: Op = [2];
    for (const ch of "hey") {
      const next = text.slice(0, 1) + text.slice(1, -1) + ch + text.slice(-1);
      op = compose(op, diff(text, next)!);
      text = next;
    }
    expect(op).toEqual([1, "hey", 1]);
    // Backspacing over part of it, then over the text before it.
    op = compose(op, diff(text, "ahb")!);
    op = compose(op, diff("ahb", "hb")!);
    expect(op).toEqual(["h", -1, 1]);
  });

  it("refuses operations that do not fit each other", () => {
    expect(() => compose([3], [4])).toThrow("compose: lengths do not match");
    expect(() => transform([3], [4])).toThrow("transform: lengths do not match");
    expect(() => compose([2, -3], [2, -3])).toThrow("compose: lengths do not match");
  });

  it("transforms deletes against keeps and deletes against deletes", () => {
    const t = "abcdef";
    const a: Op = [1, -3, 2]; // bcd
    const b: Op = [2, -3, 1]; // cde
    const [a2, b2] = transform(a, b);
    expect(apply(b2, apply(a, t))).toBe("af");
    expect(apply(a2, apply(b, t))).toBe("af");
    expect(a2).toEqual([1, -1, 1]);
    expect(b2).toEqual([1, -1, 1]);
  });

  it("keeps its operations compact: neighbours merge, an insert goes before a delete", () => {
    // What the other Window inserted is kept as part of one run.
    expect(transform([1, "a", 2], [3])).toEqual([[1, "a", 2], [4]]);
    expect(compose([-1, 2], [-1, 1])).toEqual([-2, 1]);
    expect(compose([-1, 2], ["x", 2])).toEqual(["x", -1, 2]);
    expect(compose(["a", -1, 1], [1, "b", 1])).toEqual(["ab", -1, 1]);
  });
});
