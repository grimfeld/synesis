// Which editor Commands act on (spec #206). Two kinds of editor claim it:
//
// - A Writing page (or a Hub's About) registers while its Pane is the active
//   one; the last one registered wins (spec #35). This is unchanged.
// - An editor that is active only while focused (a capture box) claims it on
//   focus and gives it back on blur, so a Command never hits the Writing page
//   behind the box. Opening the Command palette moves focus out of the box,
//   so a blur into the palette keeps the claim ("kept") until focus lands
//   anywhere else or the box unmounts; a Command run from the palette then
//   still reaches the box.
//
// Pure: the DOM glue (which blur is into the palette) is in src/editor/active.ts.

export interface ActiveEditor<V> {
  /** The editor Commands act on: a box holding focus, else the Writing page. */
  active(): V | null;
  /** Whether `active()` is a box (unlocked by Reading mode), not the Writing page. */
  boxActive(): boolean;
  /** A Writing page becomes the one Commands fall back to. */
  register(view: V): void;
  /** `view` unmounts or stops being the Writing page: forget every claim it holds. */
  release(view: V): void;
  /** A box took focus. */
  focus(view: V): void;
  /** A box lost focus; `kept` when focus went into the Command palette. */
  blur(view: V, opts: { kept: boolean }): void;
  /** Focus landed outside every box and outside the palette. */
  focusElsewhere(): void;
  subscribe(listener: () => void): () => void;
}

export function createActiveEditor<V>(): ActiveEditor<V> {
  let page: V | null = null;
  let box: V | null = null;
  // The box lost focus to the palette and still holds its claim.
  let kept = false;
  const listeners = new Set<() => void>();
  const active = () => box ?? page;
  const change = (fn: () => void) => {
    const before = active();
    fn();
    if (active() !== before) for (const l of listeners) l();
  };
  return {
    active,
    boxActive: () => box !== null,
    register: (view) =>
      change(() => {
        page = view;
      }),
    release: (view) =>
      change(() => {
        if (page === view) page = null;
        if (box === view) {
          box = null;
          kept = false;
        }
      }),
    focus: (view) =>
      change(() => {
        box = view;
        kept = false;
      }),
    blur: (view, opts) =>
      change(() => {
        if (box !== view) return;
        if (opts.kept) kept = true;
        else box = null;
      }),
    focusElsewhere: () =>
      change(() => {
        if (box !== null && kept) {
          box = null;
          kept = false;
        }
      }),
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}
