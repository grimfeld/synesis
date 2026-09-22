import { createContext, useContext } from "react";
import { en, type Dict } from "./en";
import { fr } from "./fr";
import type { Lang } from "@/lib/api";

export const dictionaries: Record<Lang, Dict> = { en, fr };
export const LangContext = createContext<Lang>("en");

export function useT(): Dict {
  return dictionaries[useContext(LangContext)];
}
export function useLang(): Lang {
  return useContext(LangContext);
}

/**
 * Dates and numbers follow the app language, not the operating system's: a
 * French vault on an English machine still reads 14/09/2026.
 */
export function useFormat() {
  const lang = useLang();
  return {
    dateTime: (ms: number) => new Date(ms).toLocaleString(lang),
    date: (ms: number) => new Date(ms).toLocaleDateString(lang),
    number: (n: number) => n.toLocaleString(lang),
  };
}

/**
 * What to call a Property on screen.
 *
 * A built-in Property has a label in the current language; one the user
 * invented (`reign_start`, `destroyed`) shows exactly as they named it. The
 * name in the front matter is untouched either way — the label is display, so
 * the vault stays Obsidian-compatible (ADR 0003) and the same file reads the
 * same on every Device whatever language it is opened in.
 *
 * Every place a Property name reaches the screen goes through here, so "what
 * is this called in French" has one answer: the Hub's Dates, the Properties
 * panel, the Timeline's Lanes and its Property filter.
 */
export function propertyLabel(name: string, t: Dict): string {
  // `Object.hasOwn`, not `in` or a bare lookup: a Property the user named
  // `constructor` or `toString` would otherwise find Object's own and render a
  // function.
  const labels: Record<string, string> = t.property_labels;
  return Object.hasOwn(labels, name) ? labels[name] : name;
}
