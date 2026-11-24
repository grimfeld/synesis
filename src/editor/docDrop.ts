// A document dropped into a Composition's text (spec #202): a Clipping as an
// Embed carrying its Citation, on a line of its own; anything else as a link
// at the drop point. The drag is `src/lib/docDrag.ts`; the rows that start it
// use `src/lib/useDocDrag.ts`. Sits beside the picture-file drop in
// `pictures.ts`, and like it works in Live Preview and Source mode alike.
import { Facet, Prec, StateEffect, StateField } from "@codemirror/state";
import { EditorView, dropCursor } from "@codemirror/view";
import { isolateHistory } from "@codemirror/commands";
import { api } from "@/lib/api";
import {
  acceptsDocDrag,
  activeDocDrag,
  droppedDocDrag,
  isDocDrag,
  type DocDrag,
} from "@/lib/docDrag";
import { placeMaterial } from "@/lib/dropPlacement";
import { clippingCitation, embedLink, fileStem, linkText } from "@/lib/linkText";
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

function accepts(view: EditorView, drag: DocDrag | null): boolean {
  return acceptsDocDrag(drag, view.state.facet(docDropHost)?.owner(), view.state.readOnly);
}

/**
 * Whether a dragged document this editor accepts is over it. CodeMirror's
 * drop cursor follows every drag over the editor (it only observes), so it is
 * hidden unless this is on: only the Composition's own text shows where its
 * material will land, and a picture file or any other drag shows no cursor,
 * as before spec #202.
 */
const setAccepting = StateEffect.define<boolean>();
const accepting = StateField.define<boolean>({
  create: () => false,
  update: (v, tr) => tr.effects.reduce((v, e) => (e.is(setAccepting) ? e.value : v), v),
  provide: (f) =>
    EditorView.editorAttributes.from(f, (on): Record<string, string> =>
      on ? { class: "cm-docDropAccepted" } : {},
    ),
});

function accept(view: EditorView, on: boolean) {
  if (view.state.field(accepting) !== on) view.dispatch({ effects: setAccepting.of(on) });
}

/**
 * Drop points waiting for their document, by token, mapped through every
 * change made while it is looked up: text typed or synced meanwhile moves the
 * drop point with the words around it.
 */
const trackDrop = StateEffect.define<{ token: number; pos: number | null }>();
const dropPoints = StateField.define<ReadonlyMap<number, number>>({
  create: () => new Map(),
  update(v, tr) {
    let out = v;
    if (tr.docChanged && v.size) {
      out = new Map([...v].map(([k, p]) => [k, tr.changes.mapPos(p)]));
    }
    for (const e of tr.effects) {
      if (!e.is(trackDrop)) continue;
      const next = new Map(out);
      if (e.value.pos == null) next.delete(e.value.token);
      else next.set(e.value.token, e.value.pos);
      out = next;
    }
    return out;
  },
});
let tokens = 0;

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
    return {
      text: embedLink(s, clippingCitation(doc.frontmatter), names.ambiguous(fileStem(s.path))),
      embed: true,
    };
  }
  return { text: linkText(s, s.title, names.ambiguous(s.title)), embed: false };
}

/** Write document `id` dropped at `pos`: one transaction, selected, focused. */
async function dropDoc(view: EditorView, id: string, pos: number) {
  const token = ++tokens;
  view.dispatch({ effects: trackDrop.of({ token, pos }) });
  const m = await materialFor(view, id);
  if (!view.dom.isConnected) return;
  const at = view.state.field(dropPoints).get(token);
  const forget = trackDrop.of({ token, pos: null });
  if (!m || at == null || view.state.readOnly) {
    view.dispatch({ effects: forget });
    return;
  }
  const p = placeMaterial(view.state.doc.toString(), at, m.embed, m.text);
  view.dispatch({
    changes: { from: p.at, insert: p.insert },
    selection: p.selection,
    effects: forget,
    scrollIntoView: true,
    userEvent: "input.drop",
    // Its own Undo step, never merged with typing just before it.
    annotations: isolateHistory.of("full"),
  });
  view.focus();
}

export const docDrop = [
  dropCursor(),
  accepting,
  dropPoints,
  EditorView.baseTheme({
    ".cm-dropCursor": { display: "none" },
    "&.cm-docDropAccepted .cm-dropCursor": { display: "block" },
  }),
  Prec.high(
    EditorView.domEventHandlers({
      dragover(e, view) {
        const doc = isDocDrag(e.dataTransfer);
        // A drag from another window or another Composition finds no target.
        const ok = doc && accepts(view, activeDocDrag());
        accept(view, ok);
        if (!doc) return false;
        if (!ok) return true;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
        return false;
      },
      dragleave(e, view) {
        if (!view.dom.contains(e.relatedTarget as Node | null)) accept(view, false);
        return false;
      },
      drop(e, view) {
        accept(view, false);
        if (!isDocDrag(e.dataTransfer)) return false;
        // Handled either way: CodeMirror's own drop must never write it.
        e.preventDefault();
        // Only the drag this window started, never a payload alone.
        const drag = droppedDocDrag(e.dataTransfer);
        if (!drag || !accepts(view, drag)) return true;
        const pos =
          view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head;
        void dropDoc(view, drag.id, pos);
        return true;
      },
    }),
  ),
];
