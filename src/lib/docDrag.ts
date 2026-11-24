// A document dragged out of a list toward a Composition's text (spec #202).
//
// The drag carries a Synesis-private data type naming the document and the
// Composition it belongs to, and no `text/plain`: CodeMirror's own text drop,
// other editors and other apps find nothing to insert, and only the editor of
// that Composition reads the private type (`src/editor/docDrop.ts`).

/** The private data type. Lowercase: `DataTransfer.types` reports it so. */
export const DOC_DRAG_TYPE = "application/x-synesis-doc";

export interface DocDrag {
  /** The dragged document. Resolved again at the drop, which ignores it if gone. */
  id: string;
  /** The Composition the drag belongs to: only its editor accepts the drop. */
  composition: string;
}

/**
 * The drag in progress from this window, if any. `getData` is empty until the
 * drop, so this is what a `dragover` reads to tell its own drag from another
 * Composition's; the drop itself reads the data.
 */
let active: DocDrag | null = null;

export function activeDocDrag(): DocDrag | null {
  return active;
}

let listening = false;

/** Start carrying `drag` on `dt`. */
export function writeDocDrag(dt: DataTransfer, drag: DocDrag) {
  dt.setData(DOC_DRAG_TYPE, JSON.stringify(drag));
  dt.effectAllowed = "copy";
  active = drag;
  // The row ends its own drag, but a row unmounted mid-drag never hears its
  // `dragend`; the window hears every drop and every drag that ends in it.
  // In the bubble phase, after the editor's own `drop` has read the drag.
  if (!listening && typeof window !== "undefined") {
    listening = true;
    window.addEventListener("dragend", endDocDrag);
    window.addEventListener("drop", endDocDrag);
  }
}

/** The drag ended, dropped or not. */
export function endDocDrag() {
  active = null;
}

/** Whether `dt` carries a dragged document (readable during `dragover`). */
export function isDocDrag(dt: DataTransfer | null | undefined): boolean {
  return !!dt && Array.from(dt.types).includes(DOC_DRAG_TYPE);
}

/** The dragged document, at the drop; null for anything else or malformed data. */
export function readDocDrag(dt: DataTransfer | null | undefined): DocDrag | null {
  const raw = dt?.getData(DOC_DRAG_TYPE);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<DocDrag>;
    return typeof v.id === "string" && typeof v.composition === "string"
      ? { id: v.id, composition: v.composition }
      : null;
  } catch {
    return null;
  }
}

/**
 * The document dropped from `dt`, only if it is the drag this window started:
 * the payload alone can be written by any page or app, so a drop is trusted
 * only when it names the same document and Composition as the drag in
 * progress here. Null for anything else.
 */
export function droppedDocDrag(dt: DataTransfer | null | undefined): DocDrag | null {
  const drag = readDocDrag(dt);
  return drag && active && active.id === drag.id && active.composition === drag.composition
    ? drag
    : null;
}

/**
 * Whether an editor showing Composition `owner` (undefined: no Composition)
 * takes `drag` (null: none from this window, or unreadable). Only the
 * Composition the drag belongs to, and only while it can be written: any other
 * editor, a read-only one (Reading mode) included, shows no drop indication
 * and inserts nothing.
 */
export function acceptsDocDrag(
  drag: DocDrag | null,
  owner: string | undefined,
  readOnly: boolean,
): boolean {
  return !!drag && !readOnly && owner != null && owner === drag.composition;
}
