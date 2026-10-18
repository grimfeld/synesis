// Shelving (ADR 0012): which kinds get a Shelf in the Library and which only
// ever sit inside something else, kept here so it is tested once (`test:unit`)
// and `LibraryView` stays a dumb renderer — the `src/lib/map.ts` precedent.
//
// The split is a presentation fact, not an engine invariant: `kind` stays
// `PropertyType::Text` and the vault stays hand-editable (ADR 0003), so a
// Source written by hand as `kind: sermon` must shelve somewhere rather than
// error. It lands on Unshelved, which is also where a chapter with no parent
// waits — the row doubles as the user's fix-it queue.
import type { LibraryEntry } from "./api";

/**
 * Kinds that get a Shelf, in the order the Library draws them. A Source of one
 * of these kinds stands on its own: a book is a book whether or not anyone
 * wrote a chapter of it.
 */
export const SHELF_KINDS = [
  "book",
  "periodical",
  "video",
  "talk",
  "podcast",
  "article",
  "other",
] as const;

/**
 * Kinds that only exist inside a parent. These never get a Shelf of their own:
 * a "Chapters" row holding every chapter of every book is a junk drawer, not a
 * library. One of these without a parent is misfiled, not top-level, so it
 * falls to Unshelved.
 */
export const CHILD_KINDS = ["chapter", "issue"] as const;

/** The trailing Shelf for Sources that belong nowhere else. */
export const UNSHELVED = "unshelved";

export type ShelfKind = (typeof SHELF_KINDS)[number];
export type ChildKind = (typeof CHILD_KINDS)[number];
/** A Shelf is keyed by a kind that earns one, or by the catch-all row. */
export type ShelfId = ShelfKind | typeof UNSHELVED;

const SHELF_SET: ReadonlySet<string> = new Set(SHELF_KINDS);
const CHILD_SET: ReadonlySet<string> = new Set(CHILD_KINDS);

/** Whether this kind stands on its own and so earns a Shelf. */
export function isShelfKind(kind: string): kind is ShelfKind {
  return SHELF_SET.has(kind);
}

/** Whether this kind only makes sense inside a parent Source. */
export function isChildKind(kind: string): kind is ChildKind {
  return CHILD_SET.has(kind);
}

/**
 * The kind a new child of this parent most likely is: a book holds chapters, a
 * periodical holds issues, an issue holds articles. Only a default — the dialog
 * still lets the user say otherwise.
 */
export function childKindFor(parentKind: string): string {
  switch (parentKind) {
    case "book":
      return "chapter";
    case "periodical":
      return "issue";
    case "issue":
      return "article";
    default:
      return "article";
  }
}

/**
 * Which Shelf a Source stands on, or `null` when it does not stand on one at
 * all because it sits inside a parent.
 *
 * Three ways to reach Unshelved: a child kind that lost its parent, a kind the
 * app has never heard of, and a top-level Source whose kind is missing.
 */
export function shelfOf(entry: LibraryEntry): ShelfId | null {
  if (entry.parent_id) return null;
  const kind = entry.kind.trim().toLowerCase();
  if (isShelfKind(kind)) return kind;
  return UNSHELVED;
}

/** One row of the Library: a kind (or the catch-all) and the Sources on it. */
export interface Shelf {
  id: ShelfId;
  entries: LibraryEntry[];
}

/**
 * Arrange top-level Sources into Shelves, in `SHELF_KINDS` order with
 * Unshelved last. Empty Shelves are dropped: a vault with no podcasts should
 * not show a podcast row.
 *
 * Entry order within a Shelf is the engine's (natural sort by title), so this
 * only groups — it never reorders.
 */
export function shelve(entries: LibraryEntry[]): Shelf[] {
  const byShelf = new Map<ShelfId, LibraryEntry[]>();
  for (const e of entries) {
    const id = shelfOf(e);
    if (id === null) continue;
    byShelf.set(id, [...(byShelf.get(id) ?? []), e]);
  }
  const shelves: Shelf[] = [];
  for (const id of SHELF_KINDS) {
    const entries = byShelf.get(id);
    if (entries?.length) shelves.push({ id, entries });
  }
  const rest = byShelf.get(UNSHELVED);
  if (rest?.length) shelves.push({ id: UNSHELVED, entries: rest });
  return shelves;
}

/**
 * Every kind a Source may be, in the order the picker offers them: each
 * container followed by what it holds. Closed (PLAN §28.1): a work that fits
 * none is "other", and a kind written by hand that is not here is shown as
 * written and stands on Unshelved.
 */
export const SOURCE_KINDS = [
  "book",
  "chapter",
  "periodical",
  "issue",
  "article",
  "video",
  "talk",
  "podcast",
  "other",
] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];

const SOURCE_SET: ReadonlySet<string> = new Set(SOURCE_KINDS);

/** Whether this is one of the nine kinds the app knows. */
export function isSourceKind(kind: string): kind is SourceKind {
  return SOURCE_SET.has(kind);
}

/**
 * The kind of Source that holds one of this kind, for a kind that only exists
 * inside something: a chapter's book, an issue's periodical. `null` for a kind
 * that stands on its own.
 */
export function holderKindFor(kind: string): SourceKind | null {
  switch (kind) {
    case "chapter":
      return "book";
    case "issue":
      return "periodical";
    default:
      return null;
  }
}

/**
 * Kinds whose page offers Contains even before anything is in it: the kinds
 * `childKindFor` has a part for (§28.4). Anything else shows Contains only
 * once it holds something.
 */
export function isContainerKind(kind: string): boolean {
  return kind === "book" || kind === "periodical" || kind === "issue";
}

/** One Source in the sidebar's tree, with the Sources sitting inside it. */
export interface SourceNode {
  entry: LibraryEntry;
  children: SourceNode[];
}

/** One sidebar folder: a Shelf, and the trees of the Sources standing on it. */
export interface SourceFolder {
  id: ShelfId;
  nodes: SourceNode[];
}

/**
 * Arrange every Source the way the sidebar shows it (PLAN §28.5–6): a folder
 * per Shelf, by the same rule as the Library, and each Source's parts nested
 * beneath it to any depth.
 *
 * A parent loop (A inside B inside A) leaves no top of the loop to start
 * from; whatever no Shelf reached is filed on Unshelved, so a Source is never
 * missing from the sidebar, and each appears exactly once.
 */
export function sourceFolders(entries: LibraryEntry[]): SourceFolder[] {
  const kids = new Map<string, LibraryEntry[]>();
  for (const e of entries) {
    if (!e.parent_id) continue;
    kids.set(e.parent_id, [...(kids.get(e.parent_id) ?? []), e]);
  }
  const placed = new Set<string>();
  const grow = (entry: LibraryEntry): SourceNode => {
    placed.add(entry.id);
    const children = (kids.get(entry.id) ?? [])
      .filter((c) => !placed.has(c.id))
      .map(grow);
    return { entry, children };
  };
  const folders: SourceFolder[] = shelve(entries).map((s) => ({
    id: s.id,
    nodes: s.entries.map(grow),
  }));
  // One at a time: growing the first of a loop places the rest of it.
  const lost: SourceNode[] = [];
  for (const e of entries) if (!placed.has(e.id)) lost.push(grow(e));
  if (lost.length) {
    const rest = folders.find((f) => f.id === UNSHELVED);
    if (rest) rest.nodes.push(...lost);
    else folders.push({ id: UNSHELVED, nodes: lost });
  }
  return folders;
}

/**
 * The Sources this one sits inside, outermost first: the breadcrumb on its
 * page, and what the sidebar unfolds to show it. Stops at a loop rather than
 * walking it forever.
 */
export function ancestorsOf(entries: LibraryEntry[], id: string): LibraryEntry[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const chain: LibraryEntry[] = [];
  const seen = new Set([id]);
  let parent = byId.get(id)?.parent_id;
  while (parent && !seen.has(parent)) {
    const p = byId.get(parent);
    if (!p) break;
    seen.add(parent);
    chain.unshift(p);
    parent = p.parent_id;
  }
  return chain;
}

/** This Source and every Source inside it, at any depth. */
export function descendantIds(entries: LibraryEntry[], id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of entries) {
      if (e.parent_id && out.has(e.parent_id) && !out.has(e.id)) {
        out.add(e.id);
        grew = true;
      }
    }
  }
  return out;
}

/** How a `cover` value is meant to be resolved (ADR 0012). */
export type CoverKind =
  | { kind: "remote"; url: string }
  | { kind: "attachment"; path: string }
  | { kind: "generated" };

/**
 * Read a `cover` property. `http(s)://` is a picture on the web, anything else
 * is a path inside the vault, and nothing at all means the app draws one.
 */
export function coverKind(cover: string | null | undefined): CoverKind {
  const v = (cover ?? "").trim();
  if (!v) return { kind: "generated" };
  if (/^https?:\/\//i.test(v)) return { kind: "remote", url: v };
  return { kind: "attachment", path: v };
}

/**
 * Tailwind classes for the spine colour of a generated Cover, one per entry in
 * the `--c-cover-*` ramp (`src/index.css`, which carries a light and a dark
 * value for each). Deliberately not `--chart-*`: those are greyscale, and a
 * shelf of grey rectangles is the failure ADR 0012 set out to avoid.
 */
export const COVER_BG = [
  "bg-cover-1",
  "bg-cover-2",
  "bg-cover-3",
  "bg-cover-4",
  "bg-cover-5",
  "bg-cover-6",
] as const;

/**
 * Which spine colour a generated Cover uses. Derived from the Source's id,
 * which never changes, so a book keeps its colour: renaming it does not
 * repaint the spine, and the shelf stays recognisable between sessions.
 */
export function coverBg(id: string): (typeof COVER_BG)[number] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COVER_BG[h % COVER_BG.length];
}
