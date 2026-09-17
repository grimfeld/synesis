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
import type { DocumentPayload, Frontmatter } from "@/lib/api";

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
