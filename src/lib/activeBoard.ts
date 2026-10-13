// The Board on screen, for actions that start somewhere else.
//
// A Command runs from the palette, but exporting needs the Board's own SVG.
// So a mounted, editable Board registers what it can do, the way the editor
// registers itself for editor Commands.

export interface BoardActions {
  /** The Composition the Board belongs to. */
  id: string;
  /** Save the Board as a picture, asking where (PLAN §17.18). */
  exportPicture: () => Promise<void>;
}

const mounted: BoardActions[] = [];
const waiters = new Set<() => void>();

/** Register a mounted Board; returns the unregister. */
export function registerBoard(actions: BoardActions): () => void {
  mounted.push(actions);
  for (const w of [...waiters]) w();
  return () => {
    const i = mounted.indexOf(actions);
    if (i >= 0) mounted.splice(i, 1);
  };
}

/** The most recently mounted Board of Composition `id`, if one is on screen. */
export function activeBoard(id: string): BoardActions | undefined {
  for (let i = mounted.length - 1; i >= 0; i--)
    if (mounted[i].id === id) return mounted[i];
  return undefined;
}

/**
 * The Board of `id` once it is on screen: now if it is, otherwise when it
 * mounts, or `undefined` after `timeout` ms. For a Command that first has to
 * switch to the Board tab.
 */
export function whenBoard(id: string, timeout = 3000): Promise<BoardActions | undefined> {
  const now = activeBoard(id);
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = (b: BoardActions | undefined) => {
      waiters.delete(check);
      clearTimeout(timer);
      resolve(b);
    };
    const check = () => {
      const b = activeBoard(id);
      if (b) done(b);
    };
    const timer = setTimeout(() => done(undefined), timeout);
    waiters.add(check);
  });
}
