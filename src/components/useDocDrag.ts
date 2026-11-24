// A row that can be dragged into a Composition's text (spec #202).
//
// The row stays a button: a click keeps its own action, and a drag that went
// past the browser's threshold never also clicks. While it is dragged the
// pointer carries a chip with the row's type dot and label, and the row is
// dimmed in place (`dragging`). The drop is the editor's: `src/editor/docDrop.ts`.
import { useRef, useState, type DragEvent, type MouseEvent } from "react";
import { cn } from "cn";
import { TYPE_BG } from "@/components/DocLink";
import { useIsMobile } from "@/hooks/use-mobile";
import type { DocSummary, DocType } from "@/lib/api";
import { endDocDrag, writeDocDrag } from "@/lib/docDrag";

type Dragged = Pick<DocSummary, "id" | "type" | "label">;

/** Props to spread on a draggable row's button, and whether it is being dragged. */
export interface DocDragSource {
  dragging: boolean;
  props: {
    draggable?: boolean;
    "data-dragging"?: boolean;
    onDragStart?: (e: DragEvent) => void;
    onDragEnd?: () => void;
    onClickCapture?: (e: MouseEvent) => void;
    onPointerDown?: () => void;
  };
}

/**
 * Make a row hold `doc` as a drag toward `composition`'s text. Not draggable
 * on a phone (no drop target is on screen there), without a Composition, or
 * when `enabled` is false (for a caller's own guards).
 */
export function useDocDrag(
  doc: Dragged,
  composition: string | undefined,
  enabled = true,
): DocDragSource {
  const isMobile = useIsMobile();
  const [dragging, setDragging] = useState(false);
  // A click right after a drag is the drag's, not the row's.
  const dragged = useRef(false);
  if (!enabled || isMobile || !composition) return { dragging: false, props: {} };
  return {
    dragging,
    props: {
      draggable: true,
      "data-dragging": dragging || undefined,
      onPointerDown: () => {
        dragged.current = false;
      },
      onDragStart: (e) => {
        dragged.current = true;
        writeDocDrag(e.dataTransfer, { id: doc.id, composition });
        const chip = dragChip(doc.type, doc.label);
        document.body.appendChild(chip);
        e.dataTransfer.setDragImage(chip, 12, chip.offsetHeight / 2);
        // The browser takes its picture of the chip during `dragstart`.
        window.setTimeout(() => chip.remove(), 0);
        setDragging(true);
      },
      onDragEnd: () => {
        endDocDrag();
        setDragging(false);
      },
      onClickCapture: (e) => {
        if (!dragged.current) return;
        dragged.current = false;
        e.preventDefault();
        e.stopPropagation();
      },
    },
  };
}

/** The chip under the pointer: the type dot and the label, on one line. */
function dragChip(type: DocType, label: string): HTMLElement {
  const chip = document.createElement("div");
  chip.dataset.testid = "drag-chip";
  // In view but under everything: an element off screen is drawn blank by
  // some engines. It is gone again before the next frame.
  chip.className =
    "pointer-events-none fixed top-0 left-0 -z-10 flex max-w-60 items-center gap-2 rounded-md border bg-popover px-2 py-1 text-sm text-popover-foreground shadow-md";
  const dot = document.createElement("span");
  dot.className = cn("inline-block size-2 shrink-0 rounded-full", TYPE_BG[type] ?? TYPE_BG.other);
  const text = document.createElement("span");
  text.className = "min-w-0 truncate";
  text.textContent = label;
  chip.append(dot, text);
  return chip;
}
