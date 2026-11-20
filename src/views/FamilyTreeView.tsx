import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { CircleAlert, Maximize2, Minus, Network, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { kinGraph } from "@/lib/kinship";
import { familyLayout, type FamilyLayout, type PersonBox } from "@/lib/familyTree";
import { usePanZoom } from "@/lib/usePanZoom";
import { useQuery } from "@/lib/useQuery";
import { useStore } from "@/lib/store";
import { useTutorials } from "@/lib/tutorialState";
import { tutorial } from "@/lib/tutorials";
import { useLang, useT } from "@/i18n";
import { ViewHeader } from "@/components/ViewHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** Below this zoom the names are too small to read (12px drawn at under 7px): the boxes stay, the names go. */
export const NAMES_FROM_ZOOM = 0.6;
/** The least zoom the first drawing opens at: names at about 10px. */
const OPEN_AT_LEAST = 0.8;

/** A title cut to what its box holds at the view's font size. */
function fitted(title: string, width: number): string {
  const max = Math.max(3, Math.floor((width - 16) / 6.8));
  return title.length <= max ? title : `${title.slice(0, max - 1)}…`;
}

function focusVisible(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}

/** The drawing itself, in world units: lines, then bars, then the boxes over them. */
function Drawing({
  layout,
  names,
  label,
  onOpen,
  onFocus,
}: {
  layout: FamilyLayout;
  names: boolean;
  label: (name: string) => string;
  /** `keyboard`: Enter or Space, which no pan can have preceded. */
  onOpen: (id: string, keyboard: boolean) => void;
  onFocus: (p: PersonBox) => void;
}) {
  return (
    <>
      {layout.lines.map((l) => (
        <polyline
          key={`line-${l.child}`}
          data-testid="family-tree-line"
          data-child={l.child}
          data-parents={l.parents.join(" ")}
          points={l.points.map(([x, y]) => `${x},${y}`).join(" ")}
          fill="none"
          style={{ stroke: "var(--muted-foreground)" }}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {layout.couples.map((c) => (
        <line
          key={`bar-${c.a}-${c.b}`}
          data-testid="family-tree-bar"
          data-a={c.a}
          data-b={c.b}
          x1={c.x1}
          y1={c.y1}
          x2={c.x2}
          y2={c.y2}
          style={{ stroke: "var(--foreground)" }}
          strokeWidth={2}
          // Two parents a child names, who name no marriage: a dashed bar.
          strokeDasharray={c.named ? undefined : "5 4"}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {layout.people.map((p) => (
        <g
          key={p.id}
          data-testid="family-tree-person"
          data-id={p.id}
          data-generation={p.generation}
          data-family={p.family}
          role="button"
          tabIndex={0}
          aria-label={label(p.doc.title)}
          className="group cursor-pointer outline-none"
          transform={`translate(${p.x},${p.y})`}
          onClick={() => onOpen(p.id, false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpen(p.id, true);
            }
          }}
          onFocus={(e) => {
            // A box focused by Tab is brought into view; one clicked is already there.
            if (focusVisible(e.currentTarget)) onFocus(p);
          }}
        >
          <title>{p.doc.title}</title>
          {/* The focus ring: an outer ring in the theme's ring colour, shown on keyboard focus. */}
          <rect
            data-testid="family-tree-focus-ring"
            x={-4}
            y={-4}
            width={p.width + 8}
            height={p.height + 8}
            rx={11}
            fill="none"
            className="opacity-0 group-focus-visible:opacity-100"
            style={{ stroke: "var(--ring)" }}
            strokeWidth={2.5}
            vectorEffect="non-scaling-stroke"
          />
          <rect
            width={p.width}
            height={p.height}
            rx={8}
            style={{ fill: "var(--card)", stroke: "var(--c-character)" }}
            strokeWidth={1.5}
          />
          {names && (
            <text
              data-testid="family-tree-name"
              x={p.width / 2}
              y={p.height / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={12}
              style={{ fill: "var(--foreground)", fontFamily: "var(--font-sans)" }}
            >
              {fitted(p.doc.title, p.width)}
            </text>
          )}
        </g>
      ))}
    </>
  );
}

/**
 * The Family tree (PLAN §32): every Character with kin, each family as its own
 * tree, side by side, in rows by generation. Reads the Kinship query; writes
 * nothing. Click a person to open their Hub.
 */
export function FamilyTreeView() {
  const s = useStore();
  const t = useT();
  const lang = useLang();
  const tutorials = useTutorials();
  const { data, status, refetch } = useQuery({
    key: ["kinship"],
    // Any page can become, or stop being, a Character: no type list will do.
    deps: { any: true },
    fetch: () => api.kinship(),
    // A save that changed no tie keeps the drawing, and where the reader is in it.
    equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });
  // The layout never throws on bad data (familyTree.test.ts); should it all
  // the same, the view shows its error state rather than taking the app down,
  // since a saved layout reopens this view on every launch.
  const built = useMemo((): { layout: FamilyLayout | null; failed: boolean } => {
    if (!data) return { layout: null, failed: false };
    try {
      return { layout: familyLayout(kinGraph(data)), failed: false };
    } catch (e) {
      console.error("family tree layout failed", e);
      return { layout: null, failed: true };
    }
  }, [data]);
  const layout = built.layout;
  const pz = usePanZoom();
  const names = pz.view.k >= NAMES_FROM_ZOOM;

  const bounds = useMemo(
    () => (layout ? { x: 0, y: 0, width: layout.width, height: layout.height } : null),
    [layout],
  );
  // The first drawing frames itself; later ones leave the view where the reader put it.
  // Too large to frame with the names readable (a phone, hundreds of people),
  // it opens at the top of the largest family, names readable, instead.
  const framed = useRef(false);
  const fit = pz.fit;
  useLayoutEffect(() => {
    if (framed.current || !layout || !bounds || bounds.width <= 0) return;
    const first = layout.people.filter((p) => p.family === 0);
    const x0 = Math.min(...first.map((p) => p.x));
    const x1 = Math.max(...first.map((p) => p.x + p.width));
    framed.current = fit(bounds, { minK: OPEN_AT_LEAST, start: { x: x0, y: 0, width: x1 - x0, height: 0 } });
  }, [layout, bounds, fit]);

  // Opening is read from refs, so the drawing is not rebuilt on every pan.
  const live = useRef({ s, dragged: pz.dragged });
  live.current = { s, dragged: pz.dragged };
  const open = useCallback((id: string, keyboard: boolean) => {
    if (!keyboard && live.current.dragged()) return;
    live.current.s.openDoc(id);
  }, []);
  const reveal = pz.reveal;
  const focus = useCallback((p: PersonBox) => reveal(p), [reveal]);
  const drawing = useMemo(
    () =>
      layout && <Drawing layout={layout} names={names} label={t.family_tree.open} onOpen={open} onFocus={focus} />,
    [layout, names, t, open, focus],
  );

  const showTutorial = () => tutorials.show("family-tree", tutorial("family-tree", lang)?.steps.length ?? 1);
  const v = pz.view;
  const ready = layout && layout.people.length > 0;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <ViewHeader
        title={t.views["family-tree"]}
        icon={<Network />}
        className="h-auto min-h-12 flex-wrap gap-y-1.5 py-1.5"
        tutorials={{ kind: "family-tree" }}
      >
        {ready && (
          <>
            <Badge
              data-testid="family-tree-counts"
              variant="secondary"
              className="ml-auto h-auto min-w-0 shrink whitespace-normal tabular-nums"
            >
              {t.family_tree.counts(layout.people.length, layout.families)}
            </Badge>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                size="icon-sm"
                variant="outline"
                aria-label={t.zoom_out}
                data-testid="family-tree-zoom-out"
                onClick={() => pz.zoomBy(1 / 1.4)}
              >
                <Minus />
              </Button>
              <Button
                size="icon-sm"
                variant="outline"
                aria-label={t.zoom_in}
                data-testid="family-tree-zoom-in"
                onClick={() => pz.zoomBy(1.4)}
              >
                <Plus />
              </Button>
              <Button
                size="icon-sm"
                variant="outline"
                aria-label={t.zoom_fit}
                data-testid="family-tree-fit"
                onClick={() => bounds && pz.fit(bounds)}
              >
                <Maximize2 />
              </Button>
            </div>
          </>
        )}
      </ViewHeader>
      {built.failed ? (
        // The data was read but could not be drawn: reading it again would not help.
        <div
          className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
          role="alert"
          data-testid="family-tree-draw-failed"
        >
          <CircleAlert className="size-5 shrink-0 text-destructive" />
          <p className="max-w-sm text-sm text-muted-foreground">{t.family_tree.draw_failed}</p>
        </div>
      ) : !data && status === "error" ? (
        <div
          className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
          role="alert"
          data-testid="family-tree-load-failed"
        >
          <CircleAlert className="size-5 shrink-0 text-destructive" />
          <p className="max-w-sm text-sm text-muted-foreground">{t.family_tree.load_failed}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-auto min-h-8"
            data-testid="family-tree-retry"
            onClick={refetch}
          >
            {t.family_tree.retry}
          </Button>
        </div>
      ) : !layout ? (
        <div className="flex-1" aria-busy="true" data-testid="family-tree-loading" />
      ) : !ready ? (
        <div
          className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
          data-testid="family-tree-empty"
        >
          <Network className="size-6 shrink-0 text-muted-foreground" />
          <p className="max-w-sm text-sm text-muted-foreground">{t.family_tree.empty}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-auto min-h-8 whitespace-normal"
            data-testid="family-tree-empty-tutorial"
            onClick={showTutorial}
          >
            {t.family_tree.empty_tutorial}
          </Button>
        </div>
      ) : (
        <div
          ref={(el) => {
            pz.box.current = el;
          }}
          data-testid="family-tree"
          data-zoom={v.k.toFixed(3)}
          data-names={names ? "shown" : "hidden"}
          data-families={layout.families}
          className="relative min-h-0 min-w-0 flex-1 cursor-grab overflow-hidden active:cursor-grabbing"
          // The browser must not take the drag for scrolling or its own zoom.
          style={{ touchAction: "none" }}
          {...pz.handlers}
        >
          <svg className="absolute inset-0 size-full select-none" aria-label={t.views["family-tree"]}>
            <g transform={`translate(${v.x},${v.y}) scale(${v.k})`}>{drawing}</g>
          </svg>
        </div>
      )}
    </div>
  );
}
