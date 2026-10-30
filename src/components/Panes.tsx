// Panes: up to two documents side by side in a Window (spec #35). The state
// and its rules live in `src/lib/panes.ts`; this draws them.
//
// Each Pane is drawn inside a `PaneScope`, so the views read their own
// Pane's view, history and talk/Board split from the store unchanged. A press
// or a key inside a Pane makes it the last-used one, which the side panel, the
// Command Palette and Back follow. The side panel is drawn once, beside both
// Panes, by the last-used Pane's document (`PanelSlot`).
import {
  createContext,
  Fragment,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { SquareSplitHorizontal, X } from "lucide-react";
import { useT } from "@/i18n";
import { useIsMobile } from "@/hooks/use-mobile";
import { PaneScope, usePane, useStore } from "@/lib/store";
import { shownPanes, type PaneIndex } from "@/lib/panes";
import { clampRatio, splitFits } from "@/lib/split";
import { Divider } from "@/components/SplitPanes";
import { IconButton } from "@/components/IconButton";

const PanelSlotContext = createContext<HTMLElement | null>(null);

/**
 * Draw the side panel where it belongs: beside both Panes, and only for the
 * last-used one. `null` while the slot is not mounted yet.
 */
export function PanelSlot({ children }: { children: ReactNode }) {
  const slot = useContext(PanelSlotContext);
  const pane = usePane();
  if (!slot || !pane.active) return null;
  return createPortal(children, slot);
}

export function Panes({ view }: { view: ReactNode }) {
  const s = useStore();
  const t = useT();
  const isMobile = useIsMobile();
  const rootRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  // A phone always has one Pane; elsewhere, two when each gets the split's
  // minimum (PLAN §22.4). The hidden Pane stays in state for when there is room.
  const fits = !isMobile && splitFits(width);
  const { setTwoPanesFit } = s;
  useLayoutEffect(() => setTwoPanesFit(fits), [fits, setTwoPanesFit]);
  const shown: PaneIndex[] = fits ? shownPanes(s.panes, width) : [s.panes.lastUsed];
  const two = shown.length === 2;
  const ratio = clampRatio(s.panes.ratio, width);
  const focus = (pane: PaneIndex) => s.dispatchPanes({ type: "focus", pane });

  return (
    <PanelSlotContext.Provider value={slot}>
      <div
        ref={rootRef}
        className="flex h-full min-h-0 min-w-0 flex-1"
        data-testid="panes"
        data-count={shown.length}
      >
        {shown.map((i, n) => (
          // Keyed by the Pane, not its place: a Swap or closing the first
          // Pane moves the editor rather than remounting it.
          <Fragment key={s.panes.panes[i]?.key ?? i}>
            {n === 1 && (
              <Divider
                rootRef={rootRef}
                shown={ratio}
                width={width}
                onRatio={(r) => s.dispatchPanes({ type: "setRatio", ratio: r })}
                label={t.pane_divider}
                testid="pane-divider"
              />
            )}
            <div
              data-testid="pane"
              data-pane={i}
              data-last-used={two && s.panes.lastUsed === i ? "true" : undefined}
              className={two && n === 0 ? "relative h-full min-h-0 min-w-0" : "relative h-full min-h-0 min-w-0 flex-1"}
              style={two && n === 0 ? { flexBasis: `${ratio * 100}%` } : undefined}
              // A press or a key in a Pane makes it the one in use. Not focus:
              // a dialog closing hands focus back to where it was, which
              // would take the side panel away from a Pane just opened.
              onPointerDownCapture={() => focus(i)}
              onKeyDownCapture={() => focus(i)}
            >
              {/* The last-used Pane is marked by a thin line along its top. */}
              {two && s.panes.lastUsed === i && (
                <div
                  aria-hidden
                  data-testid="pane-mark"
                  className="pointer-events-none absolute inset-x-0 top-0 z-30 h-0.5 bg-ring/60"
                />
              )}
              <PaneScope index={i} two={two}>
                {view}
              </PaneScope>
            </div>
          </Fragment>
        ))}
      </div>
      <div ref={setSlot} className="flex min-h-0 shrink-0" data-testid="panel-slot" />
    </PanelSlotContext.Provider>
  );
}

/**
 * A Pane's own buttons, for a view's header: open what it shows in the other
 * Pane where two fit, and close this Pane while two are showing.
 */
export function PaneButtons({ openOther = true }: { openOther?: boolean }) {
  const s = useStore();
  const t = useT();
  const pane = usePane();
  return (
    <>
      {openOther && s.twoPanesFit && (
        <IconButton
          label={t.pane_open_other}
          data-testid="pane-open-other"
          onClick={() => s.openInOther(s.view)}
        >
          <SquareSplitHorizontal />
        </IconButton>
      )}
      {pane.two && (
        <IconButton
          label={t.pane_close}
          data-testid="pane-close"
          onClick={() => s.dispatchPanes({ type: "close", pane: pane.index })}
        >
          <X />
        </IconButton>
      )}
    </>
  );
}
