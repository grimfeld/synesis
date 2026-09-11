// The editor that commands act on, plus the markdown editing operations
// exposed as Commands (bold, heading, checkbox, insert link…). Kept free of
// React so the Command registry and the CodeMirror keymap share one list.
import { useSyncExternalStore } from "react";
import { EditorSelection, type ChangeSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { startCompletion } from "@codemirror/autocomplete";

let active: EditorView | null = null;
const listeners = new Set<() => void>();

export function setActiveEditor(view: EditorView | null) {
  active = view;
  for (const l of listeners) l();
}
export function getActiveEditor(): EditorView | null {
  return active;
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
/** True while a document editor is mounted. */
export function useHasEditor(): boolean {
  return useSyncExternalStore(subscribe, () => active !== null);
}

/** Wrap the selection in `mark` (or unwrap it when already wrapped). */
export function wrapSelection(view: EditorView, mark: string): boolean {
  const { from, to } = view.state.selection.main;
  const sel = view.state.doc.sliceString(from, to);
  const stripped = sel.startsWith(mark) && sel.endsWith(mark) && sel.length >= mark.length * 2;
  const insert = stripped ? sel.slice(mark.length, sel.length - mark.length) : mark + sel + mark;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + (stripped ? 0 : mark.length), head: from + insert.length - (stripped ? 0 : mark.length) },
  });
  view.focus();
  return true;
}

/** Lines touched by the main selection. */
function selectedLines(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const a = view.state.doc.lineAt(from).number;
  const b = view.state.doc.lineAt(to).number;
  const out = [];
  for (let n = a; n <= b; n++) out.push(view.state.doc.line(n));
  return out;
}

/** "" -> "# " -> "## " … "###### " -> "". */
export function cycleHeading(view: EditorView): boolean {
  const changes: ChangeSpec[] = [];
  for (const line of selectedLines(view)) {
    const m = /^(#{1,6})\s+/.exec(line.text);
    const level = m ? m[1].length : 0;
    const next = level >= 6 ? "" : "#".repeat(level + 1) + " ";
    changes.push({ from: line.from, to: line.from + (m ? m[0].length : 0), insert: next });
  }
  view.dispatch({ changes });
  view.focus();
  return true;
}

/** Add or remove a line prefix such as "- " or "> " on every selected line. */
export function togglePrefix(view: EditorView, prefix: string): boolean {
  const lines = selectedLines(view);
  const re = new RegExp("^(\\s*)" + prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const allHave = lines.every((l) => re.test(l.text));
  const changes: ChangeSpec[] = lines.map((l) => {
    const m = re.exec(l.text);
    if (allHave && m) return { from: l.from + m[1].length, to: l.from + m[0].length, insert: "" };
    const indent = /^\s*/.exec(l.text)![0].length;
    return { from: l.from + indent, insert: prefix };
  });
  view.dispatch({ changes });
  view.focus();
  return true;
}

/** Task checkbox: "- [ ] " <-> "- [x] "; a plain line becomes a task. */
export function toggleTask(view: EditorView): boolean {
  const changes: ChangeSpec[] = [];
  for (const line of selectedLines(view)) {
    const task = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]\s/.exec(line.text);
    if (task) {
      const at = line.from + task[1].length + 1;
      changes.push({ from: at, to: at + 1, insert: task[2] === " " ? "x" : " " });
      continue;
    }
    const item = /^(\s*(?:[-*+]|\d+[.)])\s+)/.exec(line.text);
    if (item) changes.push({ from: line.from + item[1].length, insert: "[ ] " });
    else {
      const indent = /^\s*/.exec(line.text)![0].length;
      changes.push({ from: line.from + indent, insert: "- [ ] " });
    }
  }
  view.dispatch({ changes });
  view.focus();
  return true;
}

/** Insert `text` at the cursor and open autocomplete (for "[[", "![[", "#"). */
export function insertAndComplete(view: EditorView, text: string, closing = ""): boolean {
  const { from, to } = view.state.selection.main;
  const selected = view.state.doc.sliceString(from, to);
  view.dispatch({
    changes: { from, to, insert: text + selected + closing },
    selection: EditorSelection.cursor(from + text.length + selected.length),
  });
  view.focus();
  if (!selected) startCompletion(view);
  return true;
}

export interface EditorCommandSpec {
  id: string;
  shortcut?: string;
  run: (view: EditorView) => boolean;
}

/** Editing operations, in palette order. Titles come from i18n in the registry. */
export const EDITOR_COMMANDS: EditorCommandSpec[] = [
  { id: "editor.bold", shortcut: "Mod+B", run: (v) => wrapSelection(v, "**") },
  { id: "editor.italic", shortcut: "Mod+I", run: (v) => wrapSelection(v, "*") },
  { id: "editor.strike", run: (v) => wrapSelection(v, "~~") },
  { id: "editor.code", run: (v) => wrapSelection(v, "`") },
  { id: "editor.heading", shortcut: "Mod+Shift+H", run: cycleHeading },
  { id: "editor.bullet", run: (v) => togglePrefix(v, "- ") },
  { id: "editor.quote", run: (v) => togglePrefix(v, "> ") },
  { id: "editor.task", shortcut: "Mod+L", run: toggleTask },
  { id: "editor.link", run: (v) => insertAndComplete(v, "[[", "]]") },
  { id: "editor.embed", run: (v) => insertAndComplete(v, "![[", "]]") },
  { id: "editor.tag", run: (v) => insertAndComplete(v, "#") },
];
