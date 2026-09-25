// Live Preview: hide markdown syntax and render its meaning, except on the
// lines the cursor is on. Purely decorations over the syntax tree; the text
// never changes. Source mode is simply this extension switched off.
import { syntaxTree } from "@codemirror/language";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { type EditorState, type Range } from "@codemirror/state";
import { revealActiveLine, throughLock } from "./lock";

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-md-bullet";
    s.textContent = "•";
    return s;
  }
}

class HrWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-md-hr-widget";
    return s;
  }
}

class TaskWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly pos: number,
  ) {
    super();
  }
  eq(o: TaskWidget) {
    return o.checked === this.checked && o.pos === this.pos;
  }
  toDOM(view: EditorView) {
    const i = document.createElement("input");
    i.type = "checkbox";
    i.checked = this.checked;
    i.className = "cm-md-task";
    i.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const at = this.pos + 1;
      // Through the lock: a checklist stays usable in Reading mode (PLAN §23.5).
      view.dispatch({ changes: { from: at, to: at + 1, insert: this.checked ? " " : "x" }, annotations: throughLock.of("checkbox") });
    });
    return i;
  }
  ignoreEvent() {
    return false;
  }
}

const bullet = Decoration.replace({ widget: new BulletWidget() });
const hr = Decoration.replace({ widget: new HrWidget() });
const hidden = Decoration.replace({});
const codeLine = Decoration.line({ class: "cm-md-codeblock" });
const quoteLine = Decoration.line({ class: "cm-md-quote-line" });
const headingLine = [1, 2, 3, 4, 5, 6].map((n) => Decoration.line({ class: `cm-md-heading-line cm-md-heading-line-${n}` }));

/** Line numbers that any selection range touches: syntax stays visible there. */
function activeLines(state: EditorState): Set<number> {
  const out = new Set<number>();
  // Locked, nothing is being edited: every line renders (PLAN §23.9).
  if (!state.facet(revealActiveLine)) return out;
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number;
    const b = state.doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) out.add(n);
  }
  return out;
}

function build(view: EditorView): DecorationSet {
  const state = view.state;
  const doc = state.doc;
  const act = activeLines(state);
  const out: Range<Decoration>[] = [];
  const isActive = (from: number, to: number) => {
    const a = doc.lineAt(from).number;
    const b = doc.lineAt(Math.max(from, to - 1)).number;
    for (let n = a; n <= b; n++) if (act.has(n)) return true;
    return false;
  };
  const hide = (from: number, to: number) => {
    if (to > from) out.push(hidden.range(from, to));
  };
  const trailingSpace = (pos: number) => (doc.sliceString(pos, pos + 1) === " " ? pos + 1 : pos);
  const eachLine = (from: number, to: number, deco: Decoration) => {
    const a = doc.lineAt(from).number;
    const b = doc.lineAt(Math.max(from, to - 1)).number;
    for (let n = a; n <= b; n++) out.push(deco.range(doc.line(n).from));
  };

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (n) => {
        const name = n.name;
        if (name.startsWith("ATXHeading")) {
          const level = Number(name.slice(10)) || 1;
          out.push(headingLine[level - 1].range(doc.lineAt(n.from).from));
          if (!isActive(n.from, n.to)) {
            const mark = n.node.getChild("HeaderMark");
            if (mark) hide(mark.from, trailingSpace(mark.to));
          }
          return;
        }
        switch (name) {
          case "Emphasis":
          case "StrongEmphasis":
          case "Strikethrough":
          case "InlineCode": {
            if (isActive(n.from, n.to)) return;
            for (const m of n.node.getChildren(name === "InlineCode" ? "CodeMark" : name === "Strikethrough" ? "StrikethroughMark" : "EmphasisMark")) hide(m.from, m.to);
            return;
          }
          case "Link": {
            if (isActive(n.from, n.to)) return;
            for (const m of n.node.getChildren("LinkMark")) hide(m.from, m.to);
            for (const u of n.node.getChildren("URL")) hide(u.from, u.to);
            return;
          }
          case "FencedCode": {
            eachLine(n.from, n.to, codeLine);
            if (isActive(n.from, n.to)) return false;
            const first = doc.lineAt(n.from);
            hide(n.from, first.to);
            const last = doc.lineAt(n.to);
            if (last.number !== first.number && /^\s*(```|~~~)\s*$/.test(last.text)) hide(last.from, last.to);
            return false;
          }
          case "Blockquote":
            eachLine(n.from, n.to, quoteLine);
            return;
          case "QuoteMark":
            if (!isActive(n.from, n.to)) hide(n.from, trailingSpace(n.to));
            return;
          case "HorizontalRule":
            if (!isActive(n.from, n.to)) out.push(hr.range(n.from, n.to));
            return;
          case "ListMark": {
            if (isActive(n.from, n.to)) return;
            const text = doc.sliceString(n.from, n.to);
            const rest = doc.sliceString(n.to, n.to + 5);
            if (/^\s\[[ xX]\]/.test(rest)) hide(n.from, trailingSpace(n.to));
            else if (/^[-*+]$/.test(text)) out.push(bullet.range(n.from, n.to));
            return;
          }
          case "TaskMarker": {
            if (isActive(n.from, n.to)) return;
            const checked = /x/i.test(doc.sliceString(n.from, n.to));
            out.push(Decoration.replace({ widget: new TaskWidget(checked, n.from) }).range(n.from, trailingSpace(n.to)));
            return;
          }
        }
        return;
      },
    });
  }
  return Decoration.set(out, true);
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet || u.startState.facet(revealActiveLine) !== u.state.facet(revealActiveLine)) this.decorations = build(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);
