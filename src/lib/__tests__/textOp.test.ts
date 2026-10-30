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
});
