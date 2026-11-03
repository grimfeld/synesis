// The smallest single change that turns one text into another: the common
// start and end are kept. An edit made in the other Pane is applied this way,
// so the caret and the undo history of this one are mapped through it rather
// than reset by a wholesale replacement (issue #50). Offsets are UTF-16.

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/** How many code units `a` and `b` share at their start, never ending inside a surrogate pair. */
function commonStart(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let start = 0;
  while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  return start > 0 && isHigh(a.charCodeAt(start - 1)) ? start - 1 : start;
}

/** How many code units `a` and `b` share at their end, after `start` and never beginning inside a surrogate pair. */
function commonEnd(a: string, b: string, start: number): number {
  const max = Math.min(a.length, b.length) - start;
  let end = 0;
  while (end < max && a.charCodeAt(a.length - 1 - end) === b.charCodeAt(b.length - 1 - end)) end++;
  return end > 0 && isLow(a.charCodeAt(a.length - end)) ? end - 1 : end;
}

export function textChange(a: string, b: string): TextChange | null {
  if (a === b) return null;
  const start = commonStart(a, b);
  const end = commonEnd(a, b, start);
  return { from: start, to: a.length - end, insert: b.slice(start, b.length - end) };
}
