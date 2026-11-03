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

/** Reads an operation part by part, taking a part in pieces where the other operation's are shorter. */
class Cursor {
  private i = 0;
  part: Part | undefined;
  constructor(private op: Op) {
    this.part = op[this.i++];
  }
  get done() {
    return this.part === undefined;
  }
  next() {
    this.part = this.op[this.i++];
  }
  /** Take `n` characters off the current keep, delete or insert. */
  take(n: number) {
    const p = this.part as Part;
    const rest = typeof p === "string" ? p.slice(n) : p > 0 ? p - n : p + n;
    if (rest === 0 || rest === "") this.next();
    else this.part = rest;
  }
}

/** How many characters both current parts span, or an error when one operation ran out first. */
function overlap(x: Cursor, y: Cursor, what: string): number {
  if (x.done || y.done) throw new Error(`${what}: an operation is too short`);
  const size = (p: Part) => (typeof p === "string" ? p.length : Math.abs(p));
  return Math.min(size(x.part as Part), size(y.part as Part));
}

/** `a` then `b`, as one operation. */
export function compose(a: Op, b: Op): Op {
  if (targetLength(a) !== baseLength(b)) throw new Error("compose: lengths do not match");
  const out = new Builder();
  const x = new Cursor(a);
  const y = new Cursor(b);
  while (!x.done || !y.done) composeStep(x, y, out);
  return out.ops;
}

function composeStep(x: Cursor, y: Cursor, out: Builder) {
  // What `a` deleted, and what `b` inserted, pass straight through.
  if (isDelete(x.part)) {
    out.delete(x.part);
    return x.next();
  }
  if (isInsert(y.part)) {
    out.insert(y.part);
    return y.next();
  }
  const n = overlap(x, y, "compose");
  // `a` kept or inserted n characters; `b` keeps or deletes them.
  if (isDelete(y.part)) {
    if (isRetain(x.part)) out.delete(n);
  } else if (isInsert(x.part)) out.insert(x.part.slice(0, n));
  else out.retain(n);
  x.take(n);
  y.take(n);
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
  const x = new Cursor(a);
  const y = new Cursor(b);
  while (!x.done || !y.done) transformStep(x, y, ap, bp);
  return [ap.ops, bp.ops];
}

function transformStep(x: Cursor, y: Cursor, ap: Builder, bp: Builder) {
  // An insert goes in as it is, and the other operation keeps it.
  if (isInsert(x.part)) {
    ap.insert(x.part);
    bp.retain(x.part.length);
    return x.next();
  }
  if (isInsert(y.part)) {
    ap.retain(y.part.length);
    bp.insert(y.part);
    return y.next();
  }
  const n = overlap(x, y, "transform");
  // Kept by both: kept. Deleted by one: that one deletes it. Deleted by
  // both: nothing left to do for either.
  if (isRetain(x.part) && isRetain(y.part)) {
    ap.retain(n);
    bp.retain(n);
  } else if (isRetain(y.part)) ap.delete(n);
  else if (isRetain(x.part)) bp.delete(n);
  x.take(n);
  y.take(n);
}
