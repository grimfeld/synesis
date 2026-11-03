// The Tags each document carries, as far as the shared filter's chosen Tags go
// (CONTEXT.md: Period). The Timeline and the Map both ask for them by Tag, so
// an undated Character or a Place that no Date query returns is still seen.
import { useMemo } from "react";
import { api, type DocTag } from "./api";
import { useQuery } from "./useQuery";

/**
 * Document id → the chosen Tags it carries. `known` are pairs the view already
 * has (the Timeline's Tags of dated documents); the documents carrying each
 * chosen Tag are added to them, each pair once. Empty when no Tag is chosen
 * and nothing is known.
 */
export function useTagsByDoc(tags: string[], known: DocTag[] = NO_TAGS): Map<string, string[]> {
  const { data } = useQuery({
    // NUL never appears in a Tag, so the key cannot run two Tags together.
    key: [tags.join("\u0000")],
    deps: { any: true },
    enabled: tags.length > 0,
    fetch: async () => {
      const lists = await Promise.all(tags.map((tg) => api.taggedDocuments(tg)));
      return tags.map((tag, i) => ({ tag, docs: lists[i] }));
    },
  });
  return useMemo(
    () => tagsByDoc(known, tags.length > 0 ? (data ?? []) : []),
    [known, data, tags],
  );
}

/**
 * Document id → its Tags: the `known` pairs, then each document carrying a
 * chosen Tag, each pair once and in the order first seen.
 */
export function tagsByDoc(
  known: DocTag[],
  tagged: { tag: string; docs: { id: string }[] }[],
): Map<string, string[]> {
  const m = new Map<string, string[]>();
  const add = (doc: string, tag: string) => {
    const list = m.get(doc);
    if (!list) m.set(doc, [tag]);
    else if (!list.includes(tag)) list.push(tag);
  };
  for (const dt of known) add(dt.doc, dt.tag);
  for (const { tag, docs } of tagged) for (const d of docs) add(d.id, tag);
  return m;
}

const NO_TAGS: DocTag[] = [];
