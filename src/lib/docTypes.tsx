// What the UI does with a document type, one entry per type.
//
// The engine says what a type *is* (`DocTypeInfo`, filled into the arrays in
// `api.ts`); this says how it *looks*: which sections its Hub shows, which
// fields its New dialog offers, and how a submitted form becomes frontmatter.
//
// It is a `Record<DocType, …>`, not a lookup with a fallback. The switch this
// replaces ended in `default: return null`, so a type whose case was never
// written rendered an empty Hub and typechecked cleanly. A total map makes the
// same omission a compile error naming the missing key — the compiler asks the
// question a person forgets, the way `Query`/`Answer` does in the engine.
//
// Scripture's book/chapter/verse arithmetic is deliberately absent. That is
// ScriptureSection's own logic and already sits in one place; splitting it
// across three descriptors would move complexity rather than concentrate it.
import type { ReactNode } from "react";
import type { DocType, DocumentPayload, Frontmatter } from "@/lib/api";

/** Everything a Hub section might need, whatever the type turns out to be. */
export interface SectionProps {
  doc: DocumentPayload;
  book?: { number: number; name: string; chapters: number[] };
  title: string;
  fm: string;
  onFmChange: (fm: string) => void;
}

/** The form state of the New dialog, as the user has filled it in so far. */
export interface FieldProps {
  f: Record<string, string>;
  set: (k: string, v: string) => void;
  title: string;
  setTitle: (t: string) => void;
}

/** What a submitted New dialog becomes. */
export interface Built {
  /** The settled title. Empty only for a Clipping, which has none (ADR 0013). */
  title: string;
  fields: Frontmatter;
  /** The body to write, when the type makes one from the form. */
  body?: string;
}

export interface DocTypeUi {
  /** The Hub's type-specific sections, or null where a type shows none. */
  Sections?: (p: SectionProps) => ReactNode;
  /** The New dialog's type-specific fields. */
  Fields?: (p: FieldProps) => ReactNode;
}

/**
 * The pair of Date Properties a page of this type is offered for its Span
 * (CONTEXT.md), or null where the type has no date convention.
 *
 * A suggestion, never a constraint. Any document carrying a recognised pair
 * gets its Span drawn whatever its type (`SPAN_PAIRS` in lib/timeline.ts), so a
 * Character who also has `start`/`end` for a reign keeps that Span; this only
 * decides which pair the New dialog and the Hub put in front of the user.
 * Place and Concept are null on purpose: a Place carries `lat`/`lon` and, in
 * one file of the demo vault, `destroyed` — offering it a Span would invent a
 * convention the vault does not have.
 *
 * Lives here rather than in the engine because Span recognition lives in the
 * UI; splitting the concept across layers would be worse than either home. If
 * recognition ever moves into the engine — the Timeline asking for Spans rather
 * than deriving them — this belongs in `DocTypeInfo` and moves with it.
 */
export const SPAN: Record<DocType, readonly [string, string] | null> = {
  character: ["born", "died"],
  event: ["start", "end"],
  journey: ["start", "end"],
  place: null,
  concept: null,
  source: null,
  note: null,
  clipping: null,
  composition: null,
  book: null,
  chapter: null,
  verse: null,
  other: null,
};

/** Whichever halves of a type's Span the user filled in. */
function spanOf(type: DocType, f: Record<string, string>): Frontmatter {
  const out: Frontmatter = {};
  for (const name of SPAN[type] ?? []) {
    if (f[name]?.trim()) out[name] = f[name].trim();
  }
  return out;
}

/**
 * Turn a filled-in New dialog into frontmatter, per type.
 *
 * Pure, and kept out of the dialog's submit handler so it can be read and
 * tested without a vault: the handler around it resolves a Source, copies a
 * Cover and calls the engine, and these rules were only ever reachable by
 * driving the app.
 *
 * A Clipping is absent on purpose — its Source may have to be created before
 * its frontmatter can name one, which is not a pure decision. Its title rule
 * lives in `titleFor` below, which is the part that is.
 */
export const FRONTMATTER: Record<
  DocType,
  ((f: Record<string, string>) => Frontmatter) | null
> = {
  source: (f) => {
    const out: Frontmatter = { kind: f.kind || "article" };
    if (f.url) out.url = f.url;
    if (f.date) out.date = f.date;
    if (f.cover) out.cover = f.cover;
    // Only ever a Source the picker resolved, so the link cannot dangle.
    if (f.parent) out.parent = `[[${f.parent}]]`;
    return out;
  },
  place: (f) => {
    const out: Frontmatter = {};
    if (f.lat) out.lat = Number(f.lat);
    if (f.lon) out.lon = Number(f.lon);
    if (f.modern_name) out.modern_name = f.modern_name;
    return out;
  },
  event: (f) => {
    const out: Frontmatter = spanOf("event", f);
    if (f.place) out.place = `[[${f.place}]]`;
    return out;
  },
  note: (f) => (f.source ? { source: `[[${f.source}]]` } : {}),
  composition: (f) => {
    const out: Frontmatter = {};
    if (f.occasion) out.occasion = f.occasion;
    if (f.date) out.date = f.date;
    return out;
  },
  clipping: null,
  // Both carry a Span and nothing else the dialog collects. `spanOf` keeps the
  // two from drifting apart from the pair `SPAN` offers.
  character: (f) => spanOf("character", f),
  concept: null,
  journey: (f) => spanOf("journey", f),
  book: null,
  chapter: null,
  verse: null,
  other: null,
};

/**
 * The title a new document is created with.
 *
 * A Clipping gets none at all: the engine names its file from the Citation in
 * its frontmatter, and a machine-made title is still a title (ADR 0013). A
 * Note left blank is stamped with the moment it was captured, because quick
 * capture is for a thought that has not been named yet; every other type falls
 * back to a placeholder the user can see and change.
 */
export function titleFor(
  type: DocType,
  typed: string,
  now: () => string,
  untitled: string,
): string {
  const title = typed.trim();
  if (type === "clipping") return "";
  if (title) return title;
  return type === "note" ? now() : untitled;
}
