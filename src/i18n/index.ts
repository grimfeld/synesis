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
