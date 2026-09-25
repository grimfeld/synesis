// Reading mode in the editor (PLAN §23.3-5): the text cannot change, the
// on-screen keyboard never comes up, and Live Preview renders every line.
//
// `readOnly` alone stops typing but not a Command from the palette — Bold,
// Heading, Insert link — which dispatches its change straight to the view.
// So the lock is a transaction filter: nothing changes the document unless it
// says it may, and only two things say so.
import {
  Annotation,
  EditorState,
  Facet,
  type Extension,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * A change allowed through the lock: ticking a checkbox (a checklist stays
 * usable while reading, §23.5), and the text being replaced from outside —
 * a reload from disk, a restored Version, a paired Device's edit — which is
 * not the user editing and must never be dropped.
 */
export const throughLock = Annotation.define<"checkbox" | "external">();

/**
 * Whether Live Preview shows a line's markdown when the selection touches it.
 * Off while locked: nothing is being edited, and a tap to open a Passage moves
 * the selection, which would otherwise show `**` and `#` under the finger.
 */
export const revealActiveLine = Facet.define<boolean, boolean>({
  combine: (v) => (v.length ? v[v.length - 1] : true),
});

/**
 * `checkboxes` is false in the Delivery view, where nothing at all is edited
 * (PLAN §23.7); Reading mode leaves them tickable (§23.5).
 */
export function lock({
  checkboxes = true,
}: { checkboxes?: boolean } = {}): Extension {
  return [
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    revealActiveLine.of(false),
    EditorState.transactionFilter.of((tr) => {
      if (!tr.docChanged) return tr;
      const why = tr.annotation(throughLock);
      if (why === "external" || (why === "checkbox" && checkboxes)) return tr;
      return [];
    }),
  ];
}
