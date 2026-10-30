// Text operations (spec #35): a change to a whole text, in the shape the
// engine's Window sessions take them (`engine::windows`). A part is a number
// of characters to keep (> 0) or delete (< 0), or a string to insert; the
// parts run from the text's first character to its last. Lengths are UTF-16
// code units, as the editor counts them.
//
// Two Windows typing at once make two operations on the same text. `transform`
// rebases each over the other, so both texts end up the same and neither
// loses a keystroke; `compose` folds typing not yet sent into one operation.
// The classic operational-transformation pair, after ot.js (MIT).
import { textChange } from "@/editor/textChange";

export type Part = number | string;
export type Op = Part[];

const isRetain = (p: Part | undefined): p is number => typeof p === "number" && p > 0;
const isDelete = (p: Part | undefined): p is number => typeof p === "number" && p < 0;
const isInsert = (p: Part | undefined): p is string => typeof p === "string";

/** Builds an operation, merging neighbours and putting an insert before a delete at the same place. */
class Builder {
  ops: Op = [];
  retain(n: number) {
    if (n === 0) return this;
    const last = this.ops.length - 1;
    if (isRetain(this.ops[last])) (this.ops[last] as number) += n;
    else this.ops.push(n);
    return this;
  }
  insert(s: string) {
    if (s === "") return this;
    const ops = this.ops;
    const last = ops.length - 1;
    if (isInsert(ops[last])) ops[last] = (ops[last] as string) + s;
    else if (isDelete(ops[last])) {
      if (isInsert(ops[last - 1])) ops[last - 1] = (ops[last - 1] as string) + s;
      else {
        ops.push(ops[last]);
        ops[last] = s;
      }
    } else ops.push(s);
    return this;
  }
  delete(n: number) {
    const d = -Math.abs(n);
    if (d === 0) return this;
    const last = this.ops.length - 1;
    if (isDelete(this.ops[last])) (this.ops[last] as number) += d;
    else this.ops.push(d);
    return this;
  }
}

/** How many characters `op` applies to. */
export function baseLength(op: Op): number {
  let n = 0;
  for (const p of op) n += typeof p === "number" ? Math.abs(p) : 0;
  return n;
}

/** How many characters `op` leaves. */
export function targetLength(op: Op): number {
  let n = 0;
  for (const p of op) n += isRetain(p) ? p : isInsert(p) ? p.length : 0;
  return n;
}

export function apply(op: Op, text: string): string {
  if (baseLength(op) !== text.length)
    throw new Error(`a change for ${baseLength(op)} characters, on a text of ${text.length}`);
  let out = "";
  let at = 0;
  for (const p of op) {
    if (isRetain(p)) {
      out += text.slice(at, at + p);
      at += p;
    } else if (isDelete(p)) at -= p;
    else out += p;
  }
  return out;
}

/** The change from `a` to `b` (their common start and end kept), or null when they are equal. */
export function diff(a: string, b: string): Op | null {
  const c = textChange(a, b);
  if (!c) return null;
  return new Builder()
    .retain(c.from)
    .insert(c.insert)
    .delete(c.to - c.from)
    .retain(a.length - c.to).ops;
}

/** `a` then `b`, as one operation. */
export function compose(a: Op, b: Op): Op {
  if (targetLength(a) !== baseLength(b)) throw new Error("compose: lengths do not match");
  const out = new Builder();
  let i = 0;
  let j = 0;
  let x: Part | undefined = a[i++];
  let y: Part | undefined = b[j++];
  for (;;) {
    if (x === undefined && y === undefined) break;
    // What `a` deleted, and what `b` inserted, pass straight through.
    if (typeof x === "number" && x < 0) {
      out.delete(x);
      x = a[i++];
      continue;
    }
    if (typeof y === "string") {
      out.insert(y);
      y = b[j++];
      continue;
    }
    if (x === undefined || y === undefined) throw new Error("compose: an operation is too short");
    if (typeof x === "number") {
      // `a` keeps x characters; `b` keeps (y > 0) or deletes (y < 0) some.
      const n = Math.min(x, Math.abs(y));
      if (y > 0) out.retain(n);
      else out.delete(n);
      x -= n;
      y = y > 0 ? y - n : y + n;
    } else {
      // `a` inserted x; `b` keeps or deletes some of it.
      const n = Math.min(x.length, Math.abs(y));
      if (y > 0) out.insert(x.slice(0, n));
      x = x.slice(n);
      y = y > 0 ? y - n : y + n;
    }
    if (x === 0 || x === "") x = a[i++];
    if (y === 0) y = b[j++];
  }
  return out.ops;
}

/**
 * Two operations made on the same text, each rebased over the other:
 * `apply(b', apply(a, t)) === apply(a', apply(b, t))`. Where both insert at
 * the same place, `a`'s text goes first.
 */
export function transform(a: Op, b: Op): [Op, Op] {
  if (baseLength(a) !== baseLength(b)) throw new Error("transform: lengths do not match");
  const ap = new Builder();
  const bp = new Builder();
  let i = 0;
  let j = 0;
  let x: Part | undefined = a[i++];
  let y: Part | undefined = b[j++];
  for (;;) {
    if (x === undefined && y === undefined) break;
    if (typeof x === "string") {
      ap.insert(x);
      bp.retain(x.length);
      x = a[i++];
      continue;
    }
    if (typeof y === "string") {
      ap.retain(y.length);
      bp.insert(y);
      y = b[j++];
      continue;
    }
    if (x === undefined || y === undefined) throw new Error("transform: an operation is too short");
    const n = Math.min(Math.abs(x), Math.abs(y));
    if (x > 0 && y > 0) {
      ap.retain(n);
      bp.retain(n);
    } else if (x < 0 && y > 0) ap.delete(n);
    else if (x > 0 && y < 0) bp.delete(n);
    // Both deleted the same characters: nothing left to do for either.
    x = x > 0 ? x - n : x + n;
    y = y > 0 ? y - n : y + n;
    if (x === 0) x = a[i++];
    if (y === 0) y = b[j++];
  }
  return [ap.ops, bp.ops];
}
