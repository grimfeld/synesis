import type { Lang } from "./api";

/**
 * Calendar dates (a Property of type "calendar", a Source's or Composition's
 * date) are written as `YYYY-MM-DD`. These read and write that form for the
 * calendar date picker, on local days so no time zone shifts a day.
 */

/** The day an ISO date names, or null when the text is anything else. */
export function readIsoDate(text: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const date = new Date(y, mo, d);
  // new Date(y, …) maps years 0–99 to 1900–1999; setFullYear does not.
  date.setFullYear(y, mo, d);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== mo ||
    date.getDate() !== d
  )
    return null;
  return date;
}

/** A day as `YYYY-MM-DD`. */
export function writeIsoDate(date: Date): string {
  const pad = (n: number, w: number) => String(n).padStart(w, "0");
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`;
}

/** The first day of the week in the app language: 0 Sunday, 1 Monday. */
export function weekStartsOn(lang: Lang): 0 | 1 {
  return lang === "fr" ? 1 : 0;
}
