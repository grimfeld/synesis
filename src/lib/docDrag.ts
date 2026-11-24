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

/** Start carrying `drag` on `dt`. */
export function writeDocDrag(dt: DataTransfer, drag: DocDrag) {
  dt.setData(DOC_DRAG_TYPE, JSON.stringify(drag));
  dt.effectAllowed = "copy";
  active = drag;
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
