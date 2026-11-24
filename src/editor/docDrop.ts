// A document dropped into a Composition's text (spec #202): a Clipping as an
// Embed carrying its Citation, on a line of its own; anything else as a link
// at the drop point. The drag is `src/lib/docDrag.ts`; the rows that start it
// use `src/components/useDocDrag.ts`. Sits beside the picture-file drop in
// `pictures.ts`, and like it works in Live Preview and Source mode alike.
import { Facet, Prec } from "@codemirror/state";
import { EditorView, dropCursor } from "@codemirror/view";
import { isolateHistory } from "@codemirror/commands";
import { api } from "@/lib/api";
import { activeDocDrag, isDocDrag, readDocDrag } from "@/lib/docDrag";
import { placeMaterial } from "@/lib/dropPlacement";
import { clippingCitation, embedLink, linkText } from "@/lib/linkText";
import { envFacet } from "./decorations";

export interface DocDropHost {
  /**
   * The Composition this editor shows, whose drags it accepts. Undefined in
   * an editor that accepts none: a drag names the Composition it belongs to,
   * and every other editor leaves it alone.
   */
  owner: () => string | undefined;
}

export const docDropHost = Facet.define<DocDropHost, DocDropHost | null>({
  combine: (v) => v[0] ?? null,
});

function accepts(view: EditorView, composition: string): boolean {
  const owner = view.state.facet(docDropHost)?.owner();
  return !view.state.readOnly && owner != null && owner === composition;
}

/** The text to write for document `id`, or null if it no longer resolves. */
async function materialFor(
  view: EditorView,
  id: string,
): Promise<{ text: string; embed: boolean } | null> {
  const doc = await api.getDocument(id).catch(() => null);
  if (!doc) return null;
  const s = doc.summary;
  const names = view.state.facet(envFacet).names;
  // Only a Clipping is ever embedded (CONTEXT: an Embed is a live Clipping).
  if (s.type === "clipping") {
    const stem = s.path.replace(/\.md$/, "").split("/").pop()!;
    return {
      text: embedLink(s, clippingCitation(doc.frontmatter), names.ambiguous(stem)),
      embed: true,
    };
  }
  return { text: linkText(s, s.title, names.ambiguous(s.title)), embed: false };
}

/** Write document `id` dropped at `pos`: one transaction, selected, focused. */
async function dropDoc(view: EditorView, id: string, pos: number) {
  const m = await materialFor(view, id);
  if (!m || !view.dom.isConnected || view.state.readOnly) return;
  const text = view.state.doc.toString();
  const p = placeMaterial(text, pos, m.embed, m.text);
  view.dispatch({
    changes: { from: p.at, insert: p.insert },
    selection: p.selection,
    scrollIntoView: true,
    userEvent: "input.drop",
    // Its own Undo step, never merged with typing just before it.
    annotations: isolateHistory.of("full"),
  });
  view.focus();
}

export const docDrop = [
  dropCursor(),
  Prec.high(
    EditorView.domEventHandlers({
      dragover(e, view) {
        if (!isDocDrag(e.dataTransfer)) return false;
        const drag = activeDocDrag();
        // A drag from another window or another Composition finds no target.
        if (!drag || !accepts(view, drag.composition)) return true;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
        return false;
      },
      drop(e, view) {
        if (!isDocDrag(e.dataTransfer)) return false;
        // Handled either way: CodeMirror's own drop must never write it.
        e.preventDefault();
        const drag = readDocDrag(e.dataTransfer);
        if (!drag || !accepts(view, drag.composition)) return true;
        const pos =
          view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head;
        void dropDoc(view, drag.id, pos);
        return true;
      },
    }),
  ),
];
