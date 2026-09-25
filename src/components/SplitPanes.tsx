// A Composition's talk and its Board side by side (PLAN §22), with a divider
// between them. The geometry lives in `src/lib/split.ts`.
//
// Also the Talk tab's frame, with no Board: the talk keeps the same place in
// the tree whether or not the Board is beside it, so switching between Talk
// and Split does not remount the editor and lose its undo history and scroll.
import { useRef, type ReactNode } from "react";
import { cn } from "cn";
import { useT } from "@/i18n";
import { clampRatio, RATIO_STEP, ratioAt } from "@/lib/split";

export function SplitPanes({
  ratio,
  onRatio,
  width,
  talk,
  board,
}: {
  /** The talk's share of `width`, as stored; clamped here for drawing. */
  ratio: number;
  onRatio: (r: number) => void;
  /** The width both panes share, measured by the caller. */
  width: number;
  talk: ReactNode;
  /** The Board beside the talk, or null for the talk alone. */
  board: ReactNode | null;
}) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const shown = clampRatio(ratio, width);

  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    const root = rootRef.current;
    if (!root || e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = root.getBoundingClientRect();
      onRatio(ratioAt(ev.clientX, r.left, r.width));
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  // Which side has focus shows as a line along its top edge, since keys go
  // to that side only (PLAN §22.6).
  const pane =
    "flex min-h-0 min-w-0 flex-col focus-within:shadow-[inset_0_2px_0_var(--ring)]";

  const split = board !== null;
  return (
    <div
      ref={rootRef}
      className="flex min-h-0 flex-1"
      data-testid={split ? "split" : undefined}
    >
      <div
        className={split ? pane : "flex min-h-0 min-w-0 flex-1 flex-col"}
        style={split ? { flexBasis: `${shown * 100}%` } : undefined}
        data-testid={split ? "split-talk" : undefined}
      >
        {talk}
      </div>
      {split && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t.split_divider}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(shown * 100)}
          tabIndex={0}
          data-testid="split-divider"
          className={cn(
            "group relative z-10 w-px shrink-0 cursor-col-resize touch-none bg-border outline-none",
            // A wider invisible grip than the 1px line it draws.
            "before:absolute before:inset-y-0 before:-left-1.5 before:w-3",
            "hover:bg-ring focus-visible:bg-ring",
          )}
          onPointerDown={drag}
          onDoubleClick={() => onRatio(0.5)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft")
              onRatio(clampRatio(shown - RATIO_STEP, width));
            else if (e.key === "ArrowRight")
              onRatio(clampRatio(shown + RATIO_STEP, width));
            else return;
            e.preventDefault();
          }}
        />
      )}
      {split && (
        <div className={cn(pane, "flex-1")} data-testid="split-board">
          {board}
        </div>
      )}
    </div>
  );
}
