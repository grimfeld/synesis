// Seeded random edits for the text-operation and Window-sync tests.

/** A small seeded generator, so a failure replays. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A random edit of `text`: an insert, a delete, or a replacement. */
export function randomEdit(text: string, r: () => number): string {
  const at = Math.floor(r() * (text.length + 1));
  const len = Math.floor(r() * Math.min(4, text.length - at + 1));
  const ins = r() < 0.7 ? "xyzé\n".slice(0, Math.floor(r() * 4)) : "";
  return text.slice(0, at) + ins + text.slice(at + len);
}
