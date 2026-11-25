// A Board's text bubble (spec #207): the shared editor, rendered read-only at
// rest — Live Preview on every line, Pictures drawn, a link, Tag or Passage
// opening on click — and editable in place after a double-click, with what a
// Writing page has: `[[` and `#` autocomplete, Passage decorations with hover
// cards, the editor Commands. Blur or Escape hands the text back to the Board,
// which saves it through its own debounced save; every keystroke is also told
// to the Board (`onDraft`), which writes it if it is left with the bubble open.
import { memo, useEffect, useRef } from "react";
import { EditorView } from "@codemirror/view";
import { Editor } from "@/editor/Editor";
import type { EditorEnv } from "@/editor/decorations";
import { KEEPS_EDITOR_ATTR } from "@/editor/active";
import type { TagCount } from "@/lib/api";
import type { NameIndex } from "@/lib/names";

export interface BoardBubbleProps {
  id: string;
  text: string;
  editing: boolean;
  /** False on a Board opened for reading: a double-click edits nothing. */
  editable: boolean;
  /** Where links and Passages open: the Board decides (the Delivery view's stays over it). */
  env: EditorEnv;
  names: NameIndex;
  tags: TagCount[];
  /** The Device's Source mode, followed while editing; at rest a bubble always renders. */
  sourceMode: boolean;
  placeholder: string;
  /** The editor's accessible name while it is being edited, localized. */
  label: string;
  onEdit: (id: string) => void;
  /** The text as typed so far, while editing; null once it is back to what it opened with. */
  onDraft: (id: string, text: string | null) => void;
  /** Editing is over: the text, or null when it was left as it opened. */
  onDone: (id: string, text: string | null) => void;
}

/** Memoised: a pan or a drag re-renders the Board every frame, never its bubbles' editors. */
export const BoardBubble = memo(function BoardBubble({
  id,
  text,
  editing,
  editable,
  env,
  names,
  tags,
  sourceMode,
  placeholder,
  label,
  onEdit,
  onDraft,
  onDone,
}: BoardBubbleProps) {
  const box = useRef<HTMLDivElement>(null);
  const draft = useRef(text);
  // While editing, the editor keeps the text it opened with: a reload of the
  // Board from disk (Obsidian, a sync) must not replace what is being typed.
  // Closing saves what was typed over it; a bubble left as it opened saves
  // nothing, so the reloaded text stays.
  const openedWith = useRef<string | null>(null);
  if (!editing) openedWith.current = null;
  else if (openedWith.current === null) openedWith.current = text;
  const editingNow = useRef(editing);
  editingNow.current = editing;
  /** Where the double-click landed, for the caret. */
  const at = useRef<{ x: number; y: number } | null>(null);
  /** Handed back already, this time round: blur and a focus elsewhere both say so. */
  const finished = useRef(false);
  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    onDone(id, draft.current === openedWith.current ? null : draft.current);
  };
  const editor = () => {
    const dom = box.current?.querySelector<HTMLElement>(".cm-editor");
    return dom ? EditorView.findFromDOM(dom) : null;
  };

  // Opened for editing (a double-click, or a bubble just added): the caret
  // goes where the click was, or after the text. The Editor's own effects
  // have already unlocked it, children's effects running first.
  useEffect(() => {
    if (!editing) return;
    draft.current = openedWith.current ?? text;
    finished.current = false;
    const view = editor();
    if (!view) return;
    const p = at.current;
    at.current = null;
    const pos = (p && view.posAtCoords(p)) ?? view.state.doc.length;
    view.focus();
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    // Kept through the Command palette, the bubble is done once focus lands
    // anywhere else (the palette closing onto another field).
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target;
      if (el instanceof Node && box.current?.contains(el)) return;
      if (el instanceof Element && el.closest(`[${KEEPS_EDITOR_ATTR}]`)) return;
      finish();
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  return (
    <div
      ref={box}
      data-testid="board-bubble"
      data-editing={editing || undefined}
      className="size-full min-w-0 overflow-hidden"
      style={{ "--editor-size": "13px" } as React.CSSProperties}
      onDoubleClick={
        editable && !editing
          ? (e) => {
              at.current = { x: e.clientX, y: e.clientY };
              onEdit(id);
            }
          : undefined
      }
      onBlur={(e) => {
        if (!editing) return;
        const next = e.relatedTarget;
        // Within the bubble (its search panel), or into the Command palette
        // opened from it: still editing, so a Command picked there reaches it.
        if (next instanceof Node && box.current?.contains(next)) return;
        if (next instanceof Element && next.closest(`[${KEEPS_EDITOR_ATTR}]`)) return;
        finish();
      }}
    >
      <Editor
        value={openedWith.current ?? text}
        onChange={(t) => {
          draft.current = t;
          if (editingNow.current) onDraft(id, t === openedWith.current ? null : t);
        }}
        env={env}
        names={names}
        tags={tags}
        placeholder={placeholder}
        // Named as a text box only while it is one; at rest it is its text.
        ariaLabel={editing ? label : undefined}
        sourceMode={editing && sourceMode}
        still={!editing}
        activeWhileFocused
        fill
        tooltipsOnBody
        onEscape={() => {
          // Focus goes back to the Board (its focusable root), so its keys
          // work again at once; leaving the editor is what saves.
          const board = box.current?.parentElement?.closest<HTMLElement>("[tabindex]");
          if (board) board.focus({ preventScroll: true });
          else editor()?.contentDOM.blur();
          return true;
        }}
      />
    </div>
  );
});
