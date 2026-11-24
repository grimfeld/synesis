// What an editor needs from the app (EditorEnv), in the shape a Writing page,
// a Hub page and a capture box share: links and Passages open through the
// store, hovering one shows its card, and an Embed shows the body it names.
import { useMemo } from "react";
import type { EditorEnv } from "./decorations";
import type { HoverState } from "@/components/HoverCard";
import { api } from "@/lib/api";
import { splitFrontmatter } from "@/lib/frontmatter";
import type { NameIndex } from "@/lib/names";
import { useStore } from "@/lib/store";

/** The title and body (frontmatter left out) of the document `target` names, for an Embed. */
export async function embedText(target: string): Promise<{ title: string; body: string } | null> {
  const r = await api.resolveLink(target);
  if (!r) return null;
  const full = await api.getDocument(r.id);
  return { title: r.title, body: splitFrontmatter(full.text).body };
}

/**
 * The env of an editor that opens links and Passages through the store and
 * shows a hover card through `setHover`. A capture box's Editor opens nothing
 * (`navigate={false}`); its hover card's own buttons still use these.
 */
export function useEditorEnv(names: NameIndex, setHover: (h: HoverState | null) => void): EditorEnv {
  const s = useStore();
  return useMemo<EditorEnv>(
    () => ({
      names,
      onOpenLink: (target, other) => void s.openLink(target, other),
      onOpenPassage: (p) => s.openPassage(p),
      onPassageHover: (i) =>
        setHover(i ? { kind: "passage", passages: i.p, x: i.x, y: i.y } : null),
      onLinkHover: (i) =>
        setHover(i ? { kind: "link", target: i.target, x: i.x, y: i.y } : null),
      embedText,
    }),
    [names, s, setHover],
  );
}
