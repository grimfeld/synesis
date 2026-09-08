import { autocompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import type { NameIndex } from "@/lib/names";
import type { TagCount } from "@/lib/api";

export function makeAutocomplete(getNames: () => NameIndex, getTags: () => TagCount[]) {
  const wikilink = (ctx: CompletionContext): CompletionResult | null => {
    const m = ctx.matchBefore(/\[\[([^\[\]]*)$/);
    if (!m) return null;
    const q = m.text.slice(2);
    const opts = getNames()
      .suggest(q, 14)
      .map((e) => ({
        label: e.name,
        detail: e.alias ? "alias" : e.type,
        type: e.type,
        apply: (view: import("@codemirror/view").EditorView, _c: unknown, from: number, to: number) => {
          const after = view.state.doc.sliceString(to, to + 2) === "]]" ? 2 : 0;
          view.dispatch({ changes: { from: from + 2, to: to + after, insert: e.name + "]]" }, selection: { anchor: from + 2 + e.name.length + 2 } });
        },
      }));
    return { from: m.from, options: opts, filter: false, validFor: /^\[\[[^\[\]]*$/ };
  };
  const tag = (ctx: CompletionContext): CompletionResult | null => {
    const m = ctx.matchBefore(/(?:^|[^\p{L}\p{N}_/#&])#([\p{L}\p{N}_/-]*)$/u);
    if (!m) return null;
    const hashAt = m.text.lastIndexOf("#");
    const q = m.text.slice(hashAt + 1);
    const seen = new Set<string>();
    const options: { label: string; detail?: string; apply: string }[] = [];
    for (const t of getTags()) {
      if (q === "" || t.tag.toLowerCase().includes(q.toLowerCase())) {
        seen.add(t.tag.toLowerCase());
        options.push({ label: t.tag, detail: String(t.count), apply: "#" + t.tag });
      }
    }
    for (const e of getNames().suggest(q, 10)) {
      const asTag = e.name.replace(/\s+/g, "-");
      if (seen.has(asTag.toLowerCase())) continue;
      seen.add(asTag.toLowerCase());
      options.push({ label: asTag, detail: e.type, apply: "#" + asTag });
    }
    return { from: m.from + hashAt, options: options.slice(0, 14), filter: false, validFor: /^#[\p{L}\p{N}_/-]*$/u };
  };
  return autocompletion({ override: [wikilink, tag], icons: false, activateOnTyping: true });
}
