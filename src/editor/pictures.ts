// Pictures (ADR 0018): images kept in `Attachments/` and drawn where the text
// names them. Dropped, pasted or picked into any editor, they are copied into
// the vault by the engine and written as `![[Attachments/<name>.png]]` on a
// line of their own. Drawing them is a decoration like everything else in
// Live Preview; the text is never rewritten.
import { EditorView, Decoration, ViewPlugin, WidgetType, type DecorationSet } from "@codemirror/view";
import { Facet, RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { activeLines } from "./livePreview";

/** Extensions a Picture may have; the engine's list (`attachments::TYPES`). */
const EXT = "png|jpe?g|gif|webp";

/**
 * A Picture as written in text: `![[target|width]]` naming a picture file, or
 * markdown's `![alt](path)` as Obsidian users may have written it. The app
 * only ever writes the first (ADR 0018).
 */
export const PICTURE_RE = new RegExp(
  `!\\[\\[([^\\[\\]\\n|#]+?\\.(?:${EXT}))(?:\\|([^\\[\\]\\n]*))?\\]\\]|!\\[([^\\]\\n]*)\\]\\((<[^>\\n]+>|[^)\\s]+\\.(?:${EXT}))\\)`,
  "gi",
);

const PICTURE_FILE = new RegExp(`\\.(?:${EXT})$`, "i");
const PICTURE_TYPE = /^image\/(png|jpeg|gif|webp)$/;

/** Whether a `![[…]]` target names a Picture rather than a document. */
export function isPictureTarget(target: string): boolean {
  return PICTURE_FILE.test(target.split("|")[0].trim());
}

/** Whether a dropped or pasted file can become a Picture. */
export function isPictureFile(f: { name: string; type: string }): boolean {
  return PICTURE_FILE.test(f.name) || PICTURE_TYPE.test(f.type);
}

export interface PictureMatch {
  from: number;
  to: number;
  /** The file as named: a vault path, or the short name Obsidian writes. */
  target: string;
  /** Obsidian's `|300`, in CSS pixels; read, never written. */
  width: number | null;
}

/** Every Picture in `text`, outside code. */
export function findPictures(text: string): PictureMatch[] {
  const code: [number, number][] = [];
  const zone = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;
  let z: RegExpExecArray | null;
  while ((z = zone.exec(text))) code.push([z.index, z.index + z[0].length]);
  const out: PictureMatch[] = [];
  PICTURE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PICTURE_RE.exec(text))) {
    const from = m.index;
    const to = from + m[0].length;
    if (code.some(([a, b]) => from < b && to > a)) continue;
    let target: string;
    let width: number | null = null;
    if (m[1] !== undefined) {
      target = m[1].trim();
      const w = parseInt(m[2] ?? "", 10);
      if (w > 0) width = w;
    } else {
      const raw = m[4].replace(/^<|>$/g, "");
      try {
        target = decodeURIComponent(raw);
      } catch {
        target = raw;
      }
    }
    out.push({ from, to, target, width });
  }
  return out;
}

/** What the editor needs from the page it sits in. */
export interface PictureHost {
  /** The title a new Picture is named after (ADR 0018). */
  title: () => string;
  text: () => {
    missing: (target: string) => string;
    refused: string;
    failed: (why: string) => string;
  };
}

export const pictureHost = Facet.define<PictureHost, PictureHost | null>({
  combine: (v) => v[0] ?? null,
});

// ------------------------------------------------------------------ drawing

/** Data URLs already read, by target. Only hits: a miss is asked again. */
const cache = new Map<string, string>();
/** Bumped when Pairing delivers pictures, so every widget draws afresh. */
let arrivals = 0;
const picturesArrived = StateEffect.define<null>();
const views = new Set<EditorView>();

/**
 * Pairing delivered pictures (ADR 0019): forget what was read and redraw, so
 * a "Picture not found" box becomes the picture without reopening the page.
 */
export function onPicturesArrived(names: string[]) {
  for (const n of names) {
    cache.delete(n);
    cache.delete(n.split("/").pop()!);
  }
  arrivals++;
  for (const v of views) v.dispatch({ effects: picturesArrived.of(null) });
}

class PictureWidget extends WidgetType {
  constructor(
    readonly target: string,
    readonly width: number | null,
    readonly arrivals: number,
  ) {
    super();
  }
  eq(o: PictureWidget) {
    return o.target === this.target && o.width === this.width && o.arrivals === this.arrivals;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("div");
    box.className = "cm-picture";
    box.dataset.picture = this.target;
    box.dataset.testid = "picture";
    const show = (url: string) => {
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      img.draggable = false;
      if (this.width) img.style.width = `${this.width}px`;
      // A block's height changed once the picture decoded; let the editor
      // measure again, or the lines below it land in the wrong place.
      img.onload = () => view.requestMeasure();
      box.replaceChildren(img);
      box.dataset.state = "shown";
    };
    const missing = () => {
      const text = view.state.facet(pictureHost)?.text().missing(this.target) ?? this.target;
      const p = document.createElement("div");
      p.className = "cm-picture-missing";
      p.textContent = text;
      box.replaceChildren(p);
      box.dataset.state = "missing";
      view.requestMeasure();
    };
    const hit = cache.get(this.target);
    if (hit) show(hit);
    else {
      box.dataset.state = "loading";
      api
        .readPicture(this.target)
        .then((url) => {
          if (!url) return missing();
          cache.set(this.target, url);
          show(url);
        })
        .catch(missing);
    }
    return box;
  }
  // A click lands in the text, so the line opens for editing like any other.
  ignoreEvent() {
    return false;
  }
  get estimatedHeight() {
    return 240;
  }
}

function build(state: EditorState): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const active = activeLines(state);
  const text = state.doc.toString();
  // A line with a Picture alone on it becomes the picture; a line with other
  // text, or the line being edited, keeps its text and shows the picture below.
  const byLine = new Map<number, PictureMatch[]>();
  for (const p of findPictures(text)) {
    const n = state.doc.lineAt(p.from).number;
    byLine.set(n, [...(byLine.get(n) ?? []), p]);
  }
  for (const [n, pics] of byLine) {
    const line = state.doc.line(n);
    const alone = pics.length === 1 && line.text.trim() === text.slice(pics[0].from, pics[0].to);
    if (alone && !active.has(n)) {
      const p = pics[0];
      b.add(
        line.from,
        line.to,
        Decoration.replace({ widget: new PictureWidget(p.target, p.width, arrivals), block: true }),
      );
    } else {
      for (const p of pics) {
        b.add(
          line.to,
          line.to,
          Decoration.widget({ widget: new PictureWidget(p.target, p.width, arrivals), block: true, side: 1 }),
        );
      }
    }
  }
  return b.finish();
}

const pictureField = StateField.define<DecorationSet>({
  create: build,
  update(deco, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      tr.reconfigured ||
      tr.effects.some((e) => e.is(picturesArrived))
    ) {
      return build(tr.state);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const tracked = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {
      views.add(view);
    }
    destroy() {
      views.delete(this.view);
    }
  },
);

/** Pictures drawn in place. Live Preview only: Source mode shows the text. */
export const pictureDisplay: Extension = [pictureField, tracked];

// ---------------------------------------------------------------- inserting

function toBase64(f: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
}

/** A name for a pasted image, which arrives as `image.png` or with none. */
function fileName(f: File): string {
  if (PICTURE_FILE.test(f.name)) return f.name;
  const ext = PICTURE_TYPE.exec(f.type)?.[1] ?? "png";
  return `pasted.${ext === "jpeg" ? "jpg" : ext}`;
}

/**
 * Copy `files` into the vault, named after `title`, and return the lines to
 * write: one `![[…]]` each. Anything that is not a picture is refused with a
 * word, and a picture the engine cannot read is reported and skipped.
 */
export async function attachPictures(
  title: string,
  files: File[],
  text: ReturnType<PictureHost["text"]>,
): Promise<string[]> {
  const pictures = files.filter(isPictureFile);
  if (pictures.length < files.length) toast.error(text.refused);
  const lines: string[] = [];
  for (const f of pictures) {
    try {
      lines.push(`![[${await api.attachPicture(title, fileName(f), await toBase64(f))}]]`);
    } catch (e) {
      toast.error(text.failed(String(e)));
    }
  }
  return lines;
}

/**
 * Copy `files` into the vault and write each as `![[…]]` on its own line at
 * `at` (the cursor by default). Nothing is written while the editor is locked.
 */
export async function insertPictures(view: EditorView, files: File[], at?: number) {
  if (view.state.readOnly) return;
  const host = view.state.facet(pictureHost);
  if (!host) return;
  const lines = await attachPictures(host.title(), files, host.text());
  if (!lines.length || !view.dom.isConnected) return;
  const doc = view.state.doc;
  const pos = Math.min(at ?? view.state.selection.main.head, doc.length);
  const line = doc.lineAt(pos);
  const insert =
    (pos > line.from ? "\n" : "") +
    lines.join("\n") +
    (pos < line.to ? "\n" : "");
  view.dispatch({
    changes: { from: pos, insert },
    selection: { anchor: pos + insert.length },
    scrollIntoView: true,
  });
  view.focus();
}

/** Insert Picture: the system's picker, or the photo library on a phone. */
export function pickPictures(view: EditorView): boolean {
  if (view.state.readOnly) return false;
  const at = view.state.selection.main.head;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/gif,image/webp";
  input.multiple = true;
  input.style.display = "none";
  input.dataset.testid = "picture-input";
  input.onchange = () => {
    const files = [...(input.files ?? [])];
    input.remove();
    if (files.length) void insertPictures(view, files, at);
  };
  document.body.appendChild(input);
  input.click();
  return true;
}

function droppedFiles(e: DragEvent): File[] {
  return [...(e.dataTransfer?.files ?? [])];
}

/** Drop and paste. Active in both modes: a Picture can go in from Source mode too. */
export const pictureInput = EditorView.domEventHandlers({
  dragover(e, view) {
    if (!view.state.readOnly && e.dataTransfer?.types.includes("Files")) e.preventDefault();
    return false;
  },
  drop(e, view) {
    const files = droppedFiles(e);
    if (!files.length) return false;
    e.preventDefault();
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? undefined;
    void insertPictures(view, files, pos);
    return true;
  },
  paste(e, view) {
    // Text wins: copying from a word processor puts both text and a picture
    // of it on the clipboard, and the text is what was meant.
    if (e.clipboardData?.getData("text/plain")) return false;
    const files = [...(e.clipboardData?.files ?? [])].filter(isPictureFile);
    if (!files.length) return false;
    e.preventDefault();
    void insertPictures(view, files);
    return true;
  },
});
