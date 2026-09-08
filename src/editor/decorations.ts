// Live-preview decorations: wikilinks, tags (local, immediate) and Scripture
// Passages (from the engine, async). Nothing here ever changes the text.
import { Decoration, EditorView, ViewPlugin, ViewUpdate, WidgetType, type DecorationSet } from "@codemirror/view";
import { RangeSetBuilder, StateEffect, StateField, Facet } from "@codemirror/state";
import type { DetectedRange, PassageInfo } from "@/lib/api";
import type { NameIndex } from "@/lib/names";

export const WIKILINK_RE = /(!?)\[\[([^\[\]|#]+?)(?:#[^\[\]|]*)?(?:\|([^\[\]]*))?\]\]/g;
export const TAG_RE = /(^|[^\p{L}\p{N}_/#&])#([\p{L}\p{N}_/-]+)/gu;

export interface EditorEnv {
  names: NameIndex;
  onOpenLink: (target: string) => void;
  onOpenPassage: (p: PassageInfo, alt: boolean) => void;
  onPassageHover: (info: { p: PassageInfo[]; x: number; y: number } | null) => void;
  onLinkHover: (info: { target: string; x: number; y: number } | null) => void;
  embedText: (target: string) => Promise<{ title: string; body: string } | null>;
}

export const envFacet = Facet.define<EditorEnv, EditorEnv>({ combine: (v) => v[0] });

function skipZones(text: string): [number, number][] {
  const out: [number, number][] = [];
  const re = /```[\s\S]*?(?:```|$)|`[^`\n]*`|https?:\/\/[^\s)>\]]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push([m.index, m.index + m[0].length]);
  return out;
}
function inZone(z: [number, number][], a: number, b: number) {
  return z.some(([x, y]) => a < y && b > x);
}

/** Wikilinks and tags: computed synchronously over the visible ranges. */
export const linkDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.transactions.some((t) => t.effects.some((e) => e.is(namesChanged)))) this.decorations = this.build(u.view);
    }
    build(view: EditorView): DecorationSet {
      const env = view.state.facet(envFacet);
      const b = new RangeSetBuilder<Decoration>();
      const marks: { from: number; to: number; deco: Decoration }[] = [];
      for (const { from, to } of view.visibleRanges) {
        const text = view.state.doc.sliceString(from, to);
        const zones = skipZones(text);
        WIKILINK_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = WIKILINK_RE.exec(text))) {
          if (inZone(zones, m.index, m.index + m[0].length)) continue;
          const target = m[2].trim();
          const resolved = env.names.has(target);
          const cls = (m[1] === "!" ? "cm-wikilink cm-embed" : "cm-wikilink") + (resolved ? "" : " cm-wikilink-unresolved");
          marks.push({ from: from + m.index, to: from + m.index + m[0].length, deco: Decoration.mark({ class: cls, attributes: { "data-link": target } }) });
        }
        TAG_RE.lastIndex = 0;
        while ((m = TAG_RE.exec(text))) {
          const name = m[2].replace(/[/-]+$/, "");
          if (!name || /^\d+$/.test(name)) continue;
          const start = m.index + m[1].length;
          if (inZone(zones, start, start + 1 + name.length)) continue;
          marks.push({ from: from + start, to: from + start + 1 + name.length, deco: Decoration.mark({ class: "cm-tag", attributes: { "data-tag": name } }) });
        }
      }
      marks.sort((a, c) => a.from - c.from || a.to - c.to);
      let last = -1;
      for (const mk of marks) {
        if (mk.from < last) continue;
        b.add(mk.from, mk.to, mk.deco);
        last = mk.to;
      }
      return b.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

export const namesChanged = StateEffect.define<null>();

/** Passages come from the engine; the field maps them through edits until fresh ones arrive. */
export const setPassages = StateEffect.define<DetectedRange[]>();

export const passageField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setPassages)) {
        const b = new RangeSetBuilder<Decoration>();
        const sorted = [...e.value].sort((a, c) => a.from - c.from);
        let last = -1;
        const len = tr.state.doc.length;
        for (const r of sorted) {
          if (r.from < last || r.to > len || r.from >= r.to) continue;
          b.add(
            r.from,
            r.to,
            Decoration.mark({
              class: r.inferred ? "cm-passage cm-passage-inferred" : "cm-passage",
              attributes: { "data-passage": JSON.stringify(r.passages) },
            }),
          );
          last = r.to;
        }
        deco = b.finish();
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Embedded Clippings render below the line that embeds them. */
class EmbedWidget extends WidgetType {
  constructor(readonly target: string) {
    super();
  }
  eq(o: EmbedWidget) {
    return o.target === this.target;
  }
  toDOM(view: EditorView) {
    const env = view.state.facet(envFacet);
    const box = document.createElement("div");
    box.className = "cm-embed-box";
    box.style.cssText = "margin:6px 0 10px; padding:10px 14px; border-left:3px solid var(--c-clipping); background:var(--bg-2); border-radius:6px; font-size:.95em; white-space:pre-wrap;";
    box.textContent = "…";
    env.embedText(this.target).then((r) => {
      if (!r) {
        box.textContent = `⚠ ${this.target}`;
        return;
      }
      box.textContent = "";
      const h = document.createElement("div");
      h.style.cssText = "font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin-bottom:4px; cursor:pointer;";
      h.textContent = r.title;
      h.onclick = () => env.onOpenLink(this.target);
      box.appendChild(h);
      const p = document.createElement("div");
      p.textContent = r.body.trim();
      box.appendChild(p);
    });
    return box;
  }
  ignoreEvent() {
    return true;
  }
}

export const embedField = StateField.define<DecorationSet>({
  create: (state) => buildEmbeds(state.doc.toString()),
  update(deco, tr) {
    if (!tr.docChanged) return deco;
    return buildEmbeds(tr.state.doc.toString());
  },
  provide: (f) => EditorView.decorations.from(f),
});

function buildEmbeds(text: string): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const re = /!\[\[([^\[\]|#]+?)(?:#[^\[\]|]*)?(?:\|[^\[\]]*)?\]\]/g;
  let m: RegExpExecArray | null;
  const seen: number[] = [];
  while ((m = re.exec(text))) {
    const lineEnd = text.indexOf("\n", m.index);
    const pos = lineEnd === -1 ? text.length : lineEnd;
    if (seen.includes(pos)) continue;
    seen.push(pos);
    b.add(pos, pos, Decoration.widget({ widget: new EmbedWidget(m[1].trim()), block: true, side: 1 }));
  }
  return b.finish();
}

/** Clicks and hovers on decorated ranges. */
export const interactions = EditorView.domEventHandlers({
  click(e, view) {
    const el = (e.target as HTMLElement).closest("[data-link],[data-tag],[data-passage]") as HTMLElement | null;
    if (!el) return false;
    const env = view.state.facet(envFacet);
    if (el.dataset.passage) {
      const p = JSON.parse(el.dataset.passage) as PassageInfo[];
      if (e.metaKey || e.ctrlKey) {
        env.onOpenPassage(p[0], true);
      } else {
        const r = el.getBoundingClientRect();
        env.onPassageHover({ p, x: r.left, y: r.bottom });
      }
      e.preventDefault();
      return true;
    }
    if (el.dataset.link !== undefined) {
      env.onOpenLink(el.dataset.link);
      e.preventDefault();
      return true;
    }
    if (el.dataset.tag !== undefined) {
      env.onOpenLink(el.dataset.tag);
      e.preventDefault();
      return true;
    }
    return false;
  },
  mouseover(e, view) {
    const el = (e.target as HTMLElement).closest("[data-passage],[data-link]") as HTMLElement | null;
    if (!el) return false;
    const env = view.state.facet(envFacet);
    const r = el.getBoundingClientRect();
    if (el.dataset.passage) env.onPassageHover({ p: JSON.parse(el.dataset.passage), x: r.left, y: r.bottom });
    else if (el.dataset.link !== undefined) env.onLinkHover({ target: el.dataset.link, x: r.left, y: r.bottom });
    return false;
  },
});
