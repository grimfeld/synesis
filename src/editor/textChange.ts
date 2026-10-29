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

export function textChange(a: string, b: string): TextChange | null {
  if (a === b) return null;
  const max = Math.min(a.length, b.length);
  let start = 0;
  while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  // Back off out of a surrogate pair.
  if (start > 0 && isHigh(a.charCodeAt(start - 1))) start--;
  let end = 0;
  while (
    end < max - start &&
    a.charCodeAt(a.length - 1 - end) === b.charCodeAt(b.length - 1 - end)
  )
    end++;
  if (end > 0 && isLow(a.charCodeAt(a.length - end))) end--;
  return { from: start, to: a.length - end, insert: b.slice(start, b.length - end) };
}
