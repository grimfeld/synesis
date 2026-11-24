// A capture box (spec #206): the shared editor embedded where the user
// captures prose, with what a Writing page has — Live Preview or Source mode
// as the Device is set, `[[` and `#` autocomplete, Passage, link and Tag
// decorations with hover cards, the editor Commands, Pictures — and a box's
// own behaviour: Ctrl/⌘+Enter submits, a click opens nothing (the text is
// unsaved), and the box grows with its text to a maximum, then scrolls.
// Reading mode does not lock it.
import { useEffect, useMemo, useState } from "react";
import { Editor } from "@/editor/Editor";
import type { EditorEnv } from "@/editor/decorations";
import { HoverCard, type HoverState } from "@/components/HoverCard";
import { api, namesApi } from "@/lib/api";
import { deliverLatest } from "@/lib/latest";
import { splitFrontmatter } from "@/lib/frontmatter";
import { NameIndex } from "@/lib/names";
import { useStore } from "@/lib/store";
import { cn } from "cn";

export interface CaptureBoxProps {
  value: string;
  /** Bump to replace the text wholesale (clearing the box after a capture). */
  revision?: number;
  onChange: (text: string) => void;
  /** Ctrl/⌘+Enter. */
  onSubmit: () => void;
  /** Escape, after the autocomplete popup has had it (a dialog closing). */
  onEscape?: () => boolean | void;
  placeholder?: string;
  /** Starting height in lines; the box grows to `maxLines`, then scrolls. */
  minLines?: number;
  maxLines?: number;
  /**
   * What a dropped or pasted Picture is named after (ADR 0019): empty for an
   * untitled capture, which names it by the time of the drop.
   */
  pictureTitle?: string;
  autofocus?: boolean;
  className?: string;
  "data-testid"?: string;
}

export function CaptureBox({
  value,
  revision,
  onChange,
  onSubmit,
  onEscape,
  placeholder,
  minLines = 3,
  maxLines = 12,
  pictureTitle = "",
  autofocus,
  className,
  "data-testid": testId,
}: CaptureBoxProps) {
  const s = useStore();
  const [names, setNames] = useState(() => new NameIndex());
  const [hover, setHover] = useState<HoverState | null>(null);
  useEffect(
    () => deliverLatest(namesApi.names(), (n) => setNames(new NameIndex(n))),
    [s.changeTick, s.docs],
  );
  const env = useMemo<EditorEnv>(
    () => ({
      names,
      // The Editor opens nothing from a box (`navigate={false}`); these are
      // here for the type, and for a hover card's own buttons.
      onOpenLink: (target, other) => void s.openLink(target, other),
      onOpenPassage: (p) => s.openPassage(p),
      onPassageHover: (i) =>
        setHover(i ? { kind: "passage", passages: i.p, x: i.x, y: i.y } : null),
      onLinkHover: (i) =>
        setHover(i ? { kind: "link", target: i.target, x: i.x, y: i.y } : null),
      embedText: async (target) => {
        const r = await api.resolveLink(target);
        if (!r) return null;
        const full = await api.getDocument(r.id);
        return { title: r.title, body: splitFrontmatter(full.text).body };
      },
    }),
    [names, s],
  );
  const lines = useMemo(() => ({ min: minLines, max: maxLines }), [minLines, maxLines]);
  return (
    <div
      data-testid={testId}
      className={cn(
        "min-w-0 rounded-lg border border-input bg-transparent transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
        className,
      )}
    >
      <Editor
        value={value}
        revision={revision}
        onChange={onChange}
        env={env}
        names={names}
        tags={s.tags}
        placeholder={placeholder}
        autofocus={autofocus}
        sourceMode={s.sourceMode}
        activeWhileFocused
        navigate={false}
        onSubmit={onSubmit}
        onEscape={onEscape}
        lines={lines}
        pictureTitle={pictureTitle}
      />
      {/* Without a way out: leaving would lose the unsaved text. */}
      {hover && <HoverCard state={hover} stay onClose={() => setHover(null)} />}
    </div>
  );
}
