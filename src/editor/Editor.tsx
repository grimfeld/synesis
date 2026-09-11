import { useEffect, useRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import {
  EditorView,
  keymap,
  drawSelection,
  placeholder as cmPlaceholder,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  markdown,
  markdownKeymap,
  markdownLanguage,
} from "@codemirror/lang-markdown";
import { searchKeymap } from "@codemirror/search";
import {
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { markdownHighlight } from "./highlight";
import {
  embedField,
  envFacet,
  interactions,
  linkDecorations,
  namesChanged,
  passageField,
  setPassages,
  type EditorEnv,
} from "./decorations";
import { livePreview } from "./livePreview";
import { makeAutocomplete } from "./autocomplete";
import { EDITOR_COMMANDS, setActiveEditor } from "./active";
import { toCodeMirrorKey } from "@/lib/keys";
import { api, type DetectedRange, type TagCount } from "@/lib/api";
import type { NameIndex } from "@/lib/names";

interface Props {
  value: string;
  /** Changes whenever `value` was replaced wholesale, even to an equal text. */
  revision?: number;
  onChange: (text: string) => void;
  onDetected?: (ranges: DetectedRange[]) => void;
  env: EditorEnv;
  names: NameIndex;
  tags: TagCount[];
  placeholder?: string;
  autofocus?: boolean;
  /** Raw markdown when true; Live Preview otherwise. */
  sourceMode?: boolean;
  /** Short bottom padding and full width, for an editor embedded in a page (Hub "About"). */
  compact?: boolean;
}

/** Shortcuts from the Command registry, bound inside the editor so they win over CodeMirror's defaults. */
const editorKeymap = keymap.of(
  EDITOR_COMMANDS.filter((c) => c.shortcut).map((c) => ({
    key: toCodeMirrorKey(c.shortcut!),
    run: c.run,
  })),
);

export function Editor({
  value,
  revision,
  onChange,
  onDetected,
  env,
  names,
  tags,
  placeholder,
  autofocus,
  sourceMode = false,
  compact = false,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const lastValue = useRef(value);
  const envRef = useRef(env);
  envRef.current = env;
  const namesRef = useRef(names);
  const tagsRef = useRef(tags);
  const detectTimer = useRef<number | undefined>(undefined);
  const envCompartment = useRef(new Compartment());
  const modeCompartment = useRef(new Compartment());

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
        modeCompartment.current.of(sourceMode ? [] : livePreview),
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        // Layout that must outrank CodeMirror's base theme: prose font, centred column, outer scrolling.
        EditorView.theme({
          "&": { fontSize: "15.5px" },
          ".cm-scroller": {
            fontFamily: "var(--font-prose)",
            lineHeight: "1.65",
            overflow: "visible",
            padding: compact ? "14px 0 18px" : "12px 0 40vh",
          },
          ".cm-content": {
            flex: "0 0 auto",
            width: "100%",
            maxWidth: compact ? "none" : "720px",
            margin: "0 auto",
            padding: compact ? "0 20px" : "0 32px",
            caretColor: "var(--foreground)",
          },
          // drawSelection() paints the caret itself; the base theme makes it black.
          ".cm-cursor, .cm-dropCursor": {
            borderLeft: "2px solid var(--foreground)",
          },
          "&.cm-focused > .cm-scroller > .cm-cursorLayer .cm-cursor": {
            borderLeftColor: "var(--foreground)",
          },
        }),
        markdown({ base: markdownLanguage, addKeymap: false }),
        markdownHighlight,
        closeBrackets(),
        linkDecorations,
        passageField,
        embedField,
        interactions,
        makeAutocomplete(
          () => namesRef.current,
          () => tagsRef.current,
        ),
        cmPlaceholder(placeholder ?? ""),
        editorKeymap,
        keymap.of([
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
    setActiveEditor(view);
    runDetect(value);
    if (autofocus) view.focus();
    return () => {
      window.clearTimeout(detectTimer.current);
      setActiveEditor(null);
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live Preview <-> Source mode.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: modeCompartment.current.reconfigure(
        sourceMode ? [] : livePreview,
      ),
    });
  }, [sourceMode]);

  // External value changes (reload from disk, a restored Version).
  useEffect(() => {
    const v = viewRef.current;
    if (!v || v.state.doc.toString() === value) return;
    lastValue.current = value;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value, revision]);

  useEffect(() => {
    namesRef.current = names;
    tagsRef.current = tags;
    viewRef.current?.dispatch({ effects: namesChanged.of(null) });
  }, [names, tags]);

  return <div ref={host} />;
}
