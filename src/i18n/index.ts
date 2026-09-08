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
