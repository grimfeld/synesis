import { useEffect, useRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, drawSelection, placeholder as cmPlaceholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownKeymap } from "@codemirror/lang-markdown";
import { searchKeymap } from "@codemirror/search";
import { closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { markdownHighlight } from "./highlight";
import { embedField, envFacet, interactions, linkDecorations, namesChanged, passageField, setPassages, type EditorEnv } from "./decorations";
import { makeAutocomplete } from "./autocomplete";
import { api, type DetectedRange, type TagCount } from "@/lib/api";
import type { NameIndex } from "@/lib/names";

interface Props {
  value: string;
  onChange: (text: string) => void;
  onDetected?: (ranges: DetectedRange[]) => void;
  env: EditorEnv;
  names: NameIndex;
  tags: TagCount[];
  placeholder?: string;
  autofocus?: boolean;
}

function wrapSelection(view: EditorView, mark: string): boolean {
  const { from, to } = view.state.selection.main;
  const sel = view.state.doc.sliceString(from, to);
  const stripped = sel.startsWith(mark) && sel.endsWith(mark) && sel.length >= mark.length * 2;
  const insert = stripped ? sel.slice(mark.length, sel.length - mark.length) : mark + sel + mark;
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + (stripped ? 0 : mark.length), head: from + insert.length - (stripped ? 0 : mark.length) } });
  return true;
}

export function Editor({ value, onChange, onDetected, env, names, tags, placeholder, autofocus }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const lastValue = useRef(value);
  const envRef = useRef(env);
  envRef.current = env;
  const namesRef = useRef(names);
  const tagsRef = useRef(tags);
  const detectTimer = useRef<number | undefined>(undefined);
  const envCompartment = useRef(new Compartment());

  useEffect(() => {
    if (!host.current) return;
    const runDetect = (text: string) => {
      window.clearTimeout(detectTimer.current);
      detectTimer.current = window.setTimeout(async () => {
        try {
          const ranges = await api.detectPassages(text);
          const v = viewRef.current;
          if (!v || v.state.doc.toString() !== text) return;
          v.dispatch({ effects: setPassages.of(ranges) });
          onDetected?.(ranges);
        } catch (e) {
          console.error(e);
        }
      }, 180);
    };
    const proxyEnv: EditorEnv = {
      get names() {
        return namesRef.current;
      },
      onOpenLink: (t) => envRef.current.onOpenLink(t),
      onOpenPassage: (p, a) => envRef.current.onOpenPassage(p, a),
      onPassageHover: (i) => envRef.current.onPassageHover(i),
      onLinkHover: (i) => envRef.current.onLinkHover(i),
      embedText: (t) => envRef.current.embedText(t),
    };
    const state = EditorState.create({
      doc: value,
      extensions: [
        envCompartment.current.of(envFacet.of(proxyEnv)),
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        EditorView.theme({
          "&": { fontSize: "15.5px" },
          ".cm-scroller": { fontFamily: '"iA Writer Quattro", "Source Serif 4", Georgia, "Times New Roman", serif', lineHeight: "1.65" },
          ".cm-content": { fontFamily: "inherit" },
        }),
        markdown({ addKeymap: false }),
        markdownHighlight,
        closeBrackets(),
        linkDecorations,
        passageField,
        embedField,
        interactions,
        makeAutocomplete(() => namesRef.current, () => tagsRef.current),
        cmPlaceholder(placeholder ?? ""),
        keymap.of([
          { key: "Mod-b", run: (v) => wrapSelection(v, "**") },
          { key: "Mod-i", run: (v) => wrapSelection(v, "*") },
          ...closeBracketsKeymap,
          ...completionKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          ...markdownKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            const text = u.state.doc.toString();
            lastValue.current = text;
            onChange(text);
            runDetect(text);
          }
        }),
      ],
    });
    const view = new EditorView({ state, parent: host.current });
    viewRef.current = view;
    runDetect(value);
    if (autofocus) view.focus();
    return () => {
      window.clearTimeout(detectTimer.current);
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External value changes (reload from disk).
  useEffect(() => {
    const v = viewRef.current;
    if (!v || value === lastValue.current) return;
    lastValue.current = value;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    namesRef.current = names;
    tagsRef.current = tags;
    viewRef.current?.dispatch({ effects: namesChanged.of(null) });
  }, [names, tags]);

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />;
}
