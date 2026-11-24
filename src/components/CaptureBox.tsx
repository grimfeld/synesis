// A capture box (spec #206): the shared editor embedded where the user
// captures prose, with what a Writing page has — Live Preview or Source mode
// as the Device is set, `[[` and `#` autocomplete, Passage, link and Tag
// decorations with hover cards, the editor Commands, Pictures — and a box's
// own behaviour: Ctrl/⌘+Enter submits, a click opens nothing (the text is
// unsaved), and the box grows with its text to a maximum, then scrolls.
// Reading mode does not lock it.
import { useEffect, useMemo, useState } from "react";
import { closeCompletion, completionStatus } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { Editor } from "@/editor/Editor";
import type { EditorEnv } from "@/editor/decorations";
import { HoverCard, type HoverState } from "@/components/HoverCard";
import { api, namesApi } from "@/lib/api";
import { deliverLatest } from "@/lib/latest";
import { splitFrontmatter } from "@/lib/frontmatter";
import { NameIndex } from "@/lib/names";
import { useStore } from "@/lib/store";
import { cn } from "cn";

/**
 * A dialog's Escape with a capture box's autocomplete popup open: closes only
 * the popup and returns true, so the dialog calls `preventDefault` and stays
 * open; a second Escape closes it. Needed because a Radix dialog hears Escape
 * on the document before the editor does, and its dismissal (or a
 * `preventDefault`) leaves the editor's own Escape unrun.
 */
export function closeBoxPopup(e: KeyboardEvent): boolean {
  const dom = e.target instanceof Element ? e.target.closest<HTMLElement>(".cm-editor") : null;
  const view = dom ? EditorView.findFromDOM(dom) : null;
  if (!view || completionStatus(view.state) === null) return false;
  closeCompletion(view);
  return true;
}

export interface CaptureBoxProps {
  value: string;
  /** Bump to replace the text wholesale (clearing the box after a capture). */
  revision?: number;
  onChange: (text: string) => void;
  /** Ctrl/⌘+Enter. */
  onSubmit: () => void;
  placeholder?: string;
  /**
   * The box's accessible name (the editable content is the textbox): a
   * localized label, or `ariaLabelledBy`, the id of a visible one.
   */
  ariaLabel?: string;
  ariaLabelledBy?: string;
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
  placeholder,
  ariaLabel,
  ariaLabelledBy,
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
        ariaLabel={ariaLabel}
        ariaLabelledBy={ariaLabelledBy}
        lines={lines}
        pictureTitle={pictureTitle}
      />
      {/* Without a way out: leaving would lose the unsaved text. */}
      {hover && <HoverCard state={hover} stay onClose={() => setHover(null)} />}
    </div>
  );
}
