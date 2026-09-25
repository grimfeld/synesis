// Tutorials (PLAN §22, CONTEXT "Tutorial"): bundled markdown, one file per
// Tutorial per language, `docs/tutorials/<id>.<lang>.md`. This module loads
// them, checks their shape, says which views list which, and keeps the
// Device's progress through them. Pure apart from the bundling and the
// localStorage it is handed, so the rules are unit-tested.
import type { DocType, Lang } from "./api";
import type { DeviceKind, Method } from "./syncRules";

export const LANGS: Lang[] = ["en", "fr"];

const files = import.meta.glob("../../docs/tutorials/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** A Tutorial in one language, split into the parts its shape promises. */
export interface Tutorial {
  id: string;
  lang: Lang;
  title: string;
  /** Markdown before the steps. */
  intro: string;
  /** Markdown of each step, marker removed and indentation undone. */
  steps: string[];
  /** Markdown after the steps: reference, never steps. */
  after: string;
}

const H1 = /^#\s+(.+)$/;
const TOP_OL = /^\d+[.)]\s+/;
/** A line that belongs to the list item above it: indented, or blank. */
const INSIDE = /^(\s{2,}\S|\s*$)/;

/**
 * Split a Tutorial's markdown by its shape: `# Title`, intro prose, exactly one
 * top-level numbered list (the steps), then anything else. The shape is read
 * from structure, never from heading text, so it holds in every language.
 */
export function parseTutorial(md: string): { title: string; intro: string; steps: string[]; after: string; errors: string[] } {
  const errors: string[] = [];
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  const h = H1.exec(lines[i] ?? "");
  const title = h ? h[1].trim() : "";
  if (!h) errors.push("first line is not a `# Title`");
  else i++;

  const intro: string[] = [];
  while (i < lines.length && !TOP_OL.test(lines[i])) intro.push(lines[i++]);
  if (!intro.join("").trim()) errors.push("no intro before the steps");

  const steps: string[] = [];
  while (i < lines.length && TOP_OL.test(lines[i])) {
    const item = [lines[i].replace(TOP_OL, "")];
    i++;
    // Blank lines stay inside the item only when an indented line follows.
    while (i < lines.length && INSIDE.test(lines[i])) {
      if (!lines[i].trim()) {
        let j = i;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j >= lines.length || !/^\s{2,}\S/.test(lines[j])) break;
      }
      item.push(lines[i++]);
    }
    steps.push(dedent(item));
    while (i < lines.length && !lines[i].trim()) i++;
  }
  if (!steps.length) errors.push("no numbered list of steps");

  const rest = lines.slice(i);
  if (rest.some((l) => TOP_OL.test(l))) errors.push("more than one top-level numbered list");
  if ([...intro, ...rest].some((l) => H1.test(l))) errors.push("more than one `# Title`");
  return { title, intro: intro.join("\n").trim(), steps, after: rest.join("\n").trim(), errors };
}

/** Undo the indentation of an item's continuation lines. */
function dedent(item: string[]): string {
  const [first, ...more] = item;
  const indents = more.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)![0].length);
  const cut = indents.length ? Math.min(...indents) : 0;
  return [first, ...more.map((l) => l.slice(cut))].join("\n").trim();
}

/** `docs/tutorials/sync-icloud.mac.fr.md` -> { id: "sync-icloud.mac", lang: "fr" }. */
export function fileKey(path: string): { id: string; lang: Lang } | null {
  const m = /([^/\\]+)\.(\w+)\.md$/.exec(path);
  if (!m || !LANGS.includes(m[2] as Lang)) return null;
  return { id: m[1], lang: m[2] as Lang };
}

/** Every Command id a Tutorial names, as `[text](command:<id>)`. */
export function commandLinks(md: string): string[] {
  return [...md.matchAll(/\]\(command:([^)\s]+)\)/g)].map((m) => m[1]);
}

/** Every picture a Tutorial names, as `![alt](image:<name>)`. */
export function imageRefs(md: string): string[] {
  return [...md.matchAll(/!\[[^\]]*\]\(image:([^)\s]+)\)/g)].map((m) => m[1]);
}

/** The raw bundled files, by path. Exposed for the shape tests. */
export function bundled(): Record<string, string> {
  return files;
}

const all: Map<string, Tutorial> = (() => {
  const out = new Map<string, Tutorial>();
  for (const [path, md] of Object.entries(files)) {
    const key = fileKey(path);
    if (!key) continue;
    const p = parseTutorial(md);
    out.set(`${key.id}.${key.lang}`, { id: key.id, lang: key.lang, title: p.title, intro: p.intro, steps: p.steps, after: p.after });
  }
  return out;
})();

/** A Tutorial in a language. No fallback: a missing one fails the tests instead. */
export function tutorial(id: string, lang: Lang): Tutorial | null {
  return all.get(`${id}.${lang}`) ?? null;
}

/** A Tutorial's markdown as written, for places that show it whole (the wizard's sync step). */
export function tutorialSource(id: string, lang: Lang): string | null {
  return Object.entries(files).find(([p]) => p.endsWith(`/${id}.${lang}.md`))?.[1] ?? null;
}

/** Every Tutorial id, feature Tutorials in catalogue order, then sync ones. */
export function tutorialIds(): string[] {
  const ids = new Set([...all.values()].map((t) => t.id));
  const known: string[] = FEATURE_TUTORIALS.filter((id) => ids.has(id));
  return [...known, ...[...ids].filter((id) => !known.includes(id)).sort()];
}

/** The feature Tutorials, in the order the catalogue gives them (PLAN §22.10). */
export const FEATURE_TUTORIALS = [
  "capture",
  "passages",
  "mentions",
  "linkables",
  "properties",
  "source-mode",
  "library",
  "clippings",
  "compositions",
  "candidates",
  "boards",
  "versions",
  "hubs",
  "timeline",
  "map",
  "graph",
  "coverage",
  "palette",
  "pairing",
] as const;
export type FeatureTutorial = (typeof FEATURE_TUTORIALS)[number];

/** The folder-sync Tutorial for a method on a Device kind. */
export function syncTutorialId(method: Method, kind: DeviceKind): string {
  return `sync-${method}.${kind}`;
}

/** Where a "?" can stand. The editor and a Hub depend on the page's type. */
export type TutorialPlace =
  | { kind: "home" | "library" | "clippings" | "timeline" | "map" | "graph" | "coverage" | "settings" | "board" }
  | { kind: "editor"; type: DocType }
  | { kind: "hub"; type: DocType };

const SCRIPTURE: DocType[] = ["book", "chapter", "verse"];

/**
 * Which Tutorials a view lists (PLAN §22.1, §22.10). The table lives here, not
 * in the markdown, so one Tutorial can stand on several views. The Command
 * Palette's Tutorial is everywhere, so it is last on every list.
 */
export function tutorialsFor(place: TutorialPlace, deviceKind?: DeviceKind): string[] {
  const list = ((): string[] => {
    switch (place.kind) {
      case "home":
        return ["capture", "compositions"];
      case "library":
        return ["library"];
      case "clippings":
        return ["clippings"];
      case "timeline":
        return ["timeline", "properties"];
      case "map":
        return ["map"];
      case "graph":
        return ["graph"];
      case "coverage":
        return ["coverage", "passages"];
      case "board":
        return ["boards"];
      case "settings": {
        const sync = deviceKind ? (["icloud", "syncthing", "provider"] as Method[]).map((m) => syncTutorialId(m, deviceKind)) : [];
        return ["pairing", ...sync];
      }
      case "editor": {
        const writing = ["capture", "passages", "mentions", "linkables", "properties", "source-mode"];
        if (place.type === "composition") return ["compositions", "candidates", "boards", "versions", ...writing];
        return writing;
      }
      case "hub": {
        const base = ["hubs", "mentions", "linkables", "properties"];
        if (SCRIPTURE.includes(place.type)) return ["passages", "hubs"];
        if (place.type === "source") return ["library", "clippings", ...base];
        if (place.type === "place" || place.type === "journey") return ["map", ...base];
        if (place.type === "event" || place.type === "character") return ["timeline", ...base];
        return base;
      }
    }
  })();
  const out = [...list, "palette"];
  // A view only lists what exists in some language; the tests make that every language.
  const ids = new Set([...all.values()].map((t) => t.id));
  return out.filter((id, i) => out.indexOf(id) === i && ids.has(id));
}

// ---- progress (PLAN §22.11): per Device, keyed by id, never by language.

export interface TutorialProgress {
  /** The step the user was on, 0-based. */
  step: number;
  done: boolean;
}
export type Progress = Record<string, TutorialProgress>;

const PROGRESS_KEY = "synesis.tutorials";

export function loadProgress(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): Progress {
  try {
    const raw = storage?.getItem(PROGRESS_KEY);
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === "object" ? (v as Progress) : {};
  } catch {
    return {};
  }
}

export function saveProgress(p: Progress, storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch {
    // Private mode or a full disk: progress is a convenience, not the user's work.
  }
}

/**
 * Move to a step. Reaching the last one does not finish the Tutorial: the user
 * has to do it, and says so with "Done". A finished Tutorial stays finished
 * when reopened and walked again.
 */
export function goToStep(p: Progress, id: string, step: number, total: number): Progress {
  const clamped = Math.max(0, Math.min(step, Math.max(0, total - 1)));
  return { ...p, [id]: { step: clamped, done: p[id]?.done ?? false } };
}

export function finish(p: Progress, id: string, total: number): Progress {
  return { ...p, [id]: { step: Math.max(0, total - 1), done: true } };
}

/** Where to reopen a Tutorial: where the user left it, or the start once finished. */
export function resumeAt(p: Progress, id: string, total: number): number {
  const at = p[id];
  if (!at || at.done) return 0;
  return Math.max(0, Math.min(at.step, total - 1));
}

// ---- pictures (PLAN §22.12): on trial, chosen in Settings → Appearance.

export type ImageMode = "none" | "diagrams" | "screenshots";
export const IMAGE_MODES: ImageMode[] = ["none", "diagrams", "screenshots"];
const IMAGE_MODE_KEY = "synesis.tutorialImages";

export function loadImageMode(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): ImageMode {
  try {
    const v = storage?.getItem(IMAGE_MODE_KEY);
    return IMAGE_MODES.includes(v as ImageMode) ? (v as ImageMode) : "diagrams";
  } catch {
    return "diagrams";
  }
}

export function saveImageMode(m: ImageMode, storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(IMAGE_MODE_KEY, m);
  } catch {
    // As above.
  }
}

// Diagrams: language-neutral SVGs, one per name. Screenshots: one per name,
// language and theme, generated by scripts/tutorial-screenshots.mjs. Both are
// bundled as URLs, so a picture costs nothing until a Tutorial shows it.
const diagrams = import.meta.glob("../../docs/tutorials/diagrams/*.svg", { query: "?url", import: "default", eager: true }) as Record<string, string>;
const screenshots = import.meta.glob("../../docs/tutorials/screenshots/*.webp", { query: "?url", import: "default", eager: true }) as Record<string, string>;

export function diagramNames(): string[] {
  return Object.keys(diagrams).map((p) => /([^/\\]+)\.svg$/.exec(p)![1]);
}
export function screenshotKeys(): string[] {
  return Object.keys(screenshots).map((p) => /([^/\\]+)\.webp$/.exec(p)![1]);
}

/** The picture to show for `image:<name>`, or null when the mode shows none. */
export function imageUrl(name: string, mode: ImageMode, lang: Lang, theme: "light" | "dark"): string | null {
  if (mode === "diagrams") return Object.entries(diagrams).find(([p]) => p.endsWith(`/${name}.svg`))?.[1] ?? null;
  if (mode === "screenshots") return Object.entries(screenshots).find(([p]) => p.endsWith(`/${name}.${lang}.${theme}.webp`))?.[1] ?? null;
  return null;
}
