import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, Maximize2, Minus, Network, Plus, Search, X } from "lucide-react";
import { api, type DatedProperty } from "@/lib/api";
import { kinGraph } from "@/lib/kinship";
import {
  DEFAULT_GENERATIONS,
  MAX_GENERATIONS,
  familyLayout,
  generations,
  type FamilyLayout,
  type Focus,
  type Generations,
  type PersonBox,
} from "@/lib/familyTree";
import { fold } from "@/lib/names";
import { otherPane, type View } from "@/lib/panes";
import { usePanZoom } from "@/lib/usePanZoom";
import { useQuery } from "@/lib/useQuery";
import { useStore } from "@/lib/store";
import { useTutorials } from "@/lib/tutorialState";
import { tutorial } from "@/lib/tutorials";
import { useLang, useT } from "@/i18n";
import { ViewHeader } from "@/components/ViewHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Below this zoom the names are too small to read (12px drawn at under 7px): the boxes stay, the names go. */
export const NAMES_FROM_ZOOM = 0.6;
/** The least zoom a drawing opens at: names at about 10px. */
const OPEN_AT_LEAST = 0.8;
/** The person card's width (Tailwind `w-64`), and its room from the box and the edges. */
const CARD_WIDTH = 256;
const CARD_GAP = 8;

type FamilyTreeKind = Extract<View, { kind: "family-tree" }>;

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
  focus,
  selected,
  label,
  onSelect,
  onOpen,
  onFocus,
}: {
  layout: FamilyLayout;
  names: boolean;
  focus: string | undefined;
  selected: string | null;
  label: (name: string) => string;
  /** `keyboard`: Enter or Space, which no pan can have preceded. */
  onSelect: (id: string, keyboard: boolean) => void;
  onOpen: (id: string, other: boolean) => void;
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
      {layout.people.map((p) => {
        const isFocus = p.id === focus;
        return (
          <g
            key={p.id}
            data-testid="family-tree-person"
            data-id={p.id}
            data-generation={p.generation}
            data-family={p.family}
            data-focus={isFocus ? "true" : undefined}
            data-selected={p.id === selected ? "true" : undefined}
            role="button"
            tabIndex={0}
            aria-haspopup="dialog"
            aria-label={label(p.doc.title)}
            className="group cursor-pointer outline-none"
            transform={`translate(${p.x},${p.y})`}
            onClick={() => onSelect(p.id, false)}
            onDoubleClick={(e) => onOpen(p.id, otherPane(e))}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(p.id, true);
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
              style={{
                fill: isFocus ? "color-mix(in oklab, var(--c-character) 18%, var(--card))" : "var(--card)",
                stroke: "var(--c-character)",
              }}
              strokeWidth={isFocus || p.id === selected ? 3 : 1.5}
            />
            {names && (
              <text
                data-testid="family-tree-name"
                x={p.width / 2}
                y={p.height / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={12}
                fontWeight={isFocus ? 600 : undefined}
                style={{ fill: "var(--foreground)", fontFamily: "var(--font-sans)" }}
              >
                {fitted(p.doc.title, p.width)}
              </text>
            )}
          </g>
        );
      })}
    </>
  );
}

/** A Character's Span as written, from `born` and `died`; null when undated. */
function spanText(dates: DatedProperty[], t: ReturnType<typeof useT>): string | null {
  const born = dates.find((d) => d.name === "born" && d.date)?.text;
  const died = dates.find((d) => d.name === "died" && d.date)?.text;
  if (born && died) return `${born} – ${died}`;
  if (born) return t.family_tree.born(born);
  if (died) return t.family_tree.died(died);
  return null;
}

/**
 * The card a click on a person opens (#155): their name, their Span if dated,
 * "Focus here" and "Open Hub". Under the box in the top half of the view and
 * over it in the bottom half, as the Map's pin card; it follows the drawing
 * as it pans.
 */
function PersonCard({
  person,
  at,
  isFocus,
  onFocus,
  onOpen,
  onClose,
}: {
  person: PersonBox;
  at: { left: number; top?: number; bottom?: number };
  isFocus: boolean;
  onFocus: () => void;
  onOpen: (other: boolean) => void;
  onClose: () => void;
}) {
  const t = useT();
  const { data } = useQuery<DatedProperty[]>({
    key: ["family-tree-card", person.id],
    deps: { ids: [person.id] },
    fetch: () => api.datesOf(person.id),
    quiet: true,
  });
  const span = data ? spanText(data, t) : null;
  return (
    <div
      role="dialog"
      aria-label={person.doc.title}
      data-testid="family-tree-card"
      data-id={person.id}
      className="absolute z-10 flex w-64 max-w-[calc(100%-1rem)] min-w-0 flex-col gap-2 rounded-md border bg-popover p-2 text-xs text-popover-foreground shadow-md"
      style={{ left: at.left, top: at.top, bottom: at.bottom }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="flex min-w-0 items-start gap-1">
        <p data-testid="family-tree-card-name" className="min-w-0 flex-1 text-sm font-semibold break-words">
          {person.doc.title}
        </p>
        <Button size="icon-sm" variant="ghost" aria-label={t.close} data-testid="family-tree-card-close" onClick={onClose}>
          <X />
        </Button>
      </div>
      {span && (
        <p data-testid="family-tree-card-span" className="min-w-0 break-words text-muted-foreground">
          {span}
        </p>
      )}
      <div className="flex min-w-0 flex-wrap gap-1.5">
        {!isFocus && (
          <Button
            size="sm"
            variant="outline"
            className="h-auto min-h-8 min-w-0 whitespace-normal"
            data-testid="family-tree-card-focus"
            onClick={onFocus}
          >
            {t.family_tree.focus_here}
          </Button>
        )}
        <Button
          size="sm"
          className="h-auto min-h-8 min-w-0 whitespace-normal"
          data-testid="family-tree-card-open"
          onClick={(e) => onOpen(otherPane(e))}
        >
          {t.family_tree.open_hub}
        </Button>
      </div>
    </div>
  );
}

/** One generations control: its label, then 1 to 10 or All. */
function GenerationsSelect({
  which,
  value,
  onChange,
}: {
  which: "up" | "down";
  value: Generations;
  onChange: (g: Generations) => void;
}) {
  const t = useT();
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span className="min-w-0">{t.family_tree[which]}</span>
      <Select value={String(value)} onValueChange={(v) => onChange(generations(v === "all" ? v : Number(v)))}>
        <SelectTrigger
          size="sm"
          className="h-7 shrink-0 text-xs"
          aria-label={which === "up" ? t.family_tree.up_label : t.family_tree.down_label}
          data-testid={`family-tree-${which}`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Array.from({ length: MAX_GENERATIONS }, (_, i) => i + 1).map((n) => (
            <SelectItem key={n} value={String(n)} data-testid={`family-tree-${which}-${n}`}>
              {n}
            </SelectItem>
          ))}
          <SelectItem value="all" data-testid={`family-tree-${which}-all`}>
            {t.family_tree.all}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

/** The search box: the drawn Characters whose title holds what is typed, accent-insensitive. */
function TreeSearch({ people, onPick }: { people: PersonBox[]; onPick: (id: string) => void }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return [];
    return people
      .filter((p) => fold(p.doc.title).includes(q))
      .sort((a, b) => {
        const sa = fold(a.doc.title).startsWith(q) ? 0 : 1;
        const sb = fold(b.doc.title).startsWith(q) ? 0 : 1;
        return sa - sb || a.doc.title.localeCompare(b.doc.title);
      })
      .slice(0, 8);
  }, [people, query]);
  const pick = (id: string) => {
    onPick(id);
    setQuery("");
    setOpen(false);
  };
  return (
    <div className="relative min-w-0 flex-1 basis-40 sm:max-w-56">
      <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        className="h-7 w-full pl-7 text-xs"
        data-testid="family-tree-search"
        placeholder={t.family_tree.search}
        aria-label={t.family_tree.search}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && matches[0]) {
            e.preventDefault();
            pick(matches[0].id);
          } else if (e.key === "Escape") {
            setQuery("");
            setOpen(false);
          }
        }}
      />
      {open && query.trim() && (
        <ul
          data-testid="family-tree-search-results"
          className="absolute top-full right-0 left-0 z-20 mt-1 flex max-h-64 min-w-0 flex-col overflow-auto rounded-md border bg-popover p-1 text-xs text-popover-foreground shadow-md"
        >
          {matches.length === 0 ? (
            <li data-testid="family-tree-search-none" className="min-w-0 px-2 py-1 text-muted-foreground">
              {t.family_tree.search_none}
            </li>
          ) : (
            matches.map((p) => (
              <li key={p.id} className="min-w-0">
                <button
                  type="button"
                  data-testid="family-tree-search-result"
                  data-id={p.id}
                  className="w-full min-w-0 break-words rounded px-2 py-1 text-left hover:bg-accent"
                  // Keep the input's focus, so its blur does not close the list under the press.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(p.id)}
                >
                  {p.doc.title}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * The Family tree (PLAN §32): every Character with kin, each family as its own
 * tree, side by side, in rows by generation; or, focused (#155), one
 * Character's line, so many generations up and down. Reads the Kinship query;
 * writes nothing. A click on a person opens their card, a double-click their Hub.
 */
export function FamilyTreeView({ view }: { view: FamilyTreeKind }) {
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
  const focusId = view.focus;
  const up = view.up ?? DEFAULT_GENERATIONS;
  const down = view.down ?? DEFAULT_GENERATIONS;
  const focus = useMemo<Focus | undefined>(() => (focusId ? { id: focusId, up, down } : undefined), [focusId, up, down]);
  // The layout never throws on bad data (familyTree.test.ts); should it all
  // the same, the view shows its error state rather than taking the app down,
  // since a saved layout reopens this view on every launch.
  const built = useMemo((): { layout: FamilyLayout | null; failed: boolean } => {
    if (!data) return { layout: null, failed: false };
    try {
      return { layout: familyLayout(kinGraph(data), { focus }), failed: false };
    } catch (e) {
      console.error("family tree layout failed", e);
      return { layout: null, failed: true };
    }
  }, [data, focus]);
  const layout = built.layout;
  const pz = usePanZoom();
  const names = pz.view.k >= NAMES_FROM_ZOOM;
  const [selected, setSelected] = useState<string | null>(null);

  const bounds = useMemo(
    () => (layout ? { x: 0, y: 0, width: layout.width, height: layout.height } : null),
    [layout],
  );
  // Each drawing (everyone, or a focus with its generations) frames itself
  // once; a later change to the same one leaves the view where the reader put
  // it. Everyone, too large to frame with the names readable (a phone,
  // hundreds of people), opens at the top of the largest family; a focus too
  // large opens centred on the focused Character, names readable.
  const framedKey = useRef<string | null>(null);
  const frameKey = JSON.stringify([focusId ?? null, up, down]);
  const { fit, centre, box } = pz;
  useLayoutEffect(() => {
    if (framedKey.current === frameKey || !layout || !bounds || bounds.width <= 0) return;
    const me = focusId ? layout.people.find((p) => p.id === focusId) : undefined;
    let done: boolean;
    if (me) {
      const el = box.current;
      const k = el ? Math.min(1, (el.clientWidth - 64) / bounds.width, (el.clientHeight - 64) / Math.max(1, bounds.height)) : 1;
      done = k < OPEN_AT_LEAST ? centre(me, OPEN_AT_LEAST) : fit(bounds);
    } else {
      const first = layout.people.filter((p) => p.family === 0);
      const x0 = Math.min(...first.map((p) => p.x));
      const x1 = Math.max(...first.map((p) => p.x + p.width));
      done = fit(bounds, { minK: OPEN_AT_LEAST, start: { x: x0, y: 0, width: x1 - x0, height: 0 } });
    }
    if (done) framedKey.current = frameKey;
  }, [layout, bounds, fit, centre, box, frameKey, focusId]);

  // A card belongs to one drawing: another focus or other generations close it.
  const [cardKey, setCardKey] = useState(frameKey);
  if (cardKey !== frameKey) {
    setCardKey(frameKey);
    setSelected(null);
  }
  const shown = selected ? layout?.people.find((p) => p.id === selected) : undefined;

  // Read from refs, so the drawing is not rebuilt on every pan.
  const live = useRef({ s, dragged: pz.dragged });
  live.current = { s, dragged: pz.dragged };
  const select = useCallback((id: string, keyboard: boolean) => {
    if (!keyboard && live.current.dragged()) return;
    setSelected(id);
  }, []);
  const open = useCallback((id: string, other: boolean) => {
    if (live.current.dragged()) return;
    live.current.s.openDoc(id, other);
  }, []);
  const reveal = pz.reveal;
  const revealBox = useCallback((p: PersonBox) => reveal(p), [reveal]);
  const drawing = useMemo(
    () =>
      layout && (
        <Drawing
          layout={layout}
          names={names}
          focus={focusId}
          selected={shown?.id ?? null}
          label={t.family_tree.person}
          onSelect={select}
          onOpen={open}
          onFocus={revealBox}
        />
      ),
    [layout, names, focusId, shown, t, select, open, revealBox],
  );

  const showTutorial = () => tutorials.show("family-tree", tutorial("family-tree", lang)?.steps.length ?? 1);
  const v = pz.view;
  const ready = layout && layout.people.length > 0;
  const focusTitle = focusId
    ? (s.docsById.get(focusId)?.title ?? layout?.people.find((p) => p.id === focusId)?.doc.title)
    : undefined;

  const setGenerations = (which: "up" | "down", g: Generations) =>
    s.replaceView({ kind: "family-tree", focus: focusId, up, down, [which]: g });
  // Focused, a new focus keeps the generations chosen; from everyone, 3 and 3.
  const refocus = (id: string) =>
    s.navigate(focusId ? { kind: "family-tree", focus: id, up, down } : { kind: "family-tree", focus: id });

  // Where the card stands: under the box in the top half, over it in the bottom half.
  const cardAt = (() => {
    const el = box.current;
    if (!shown || !el) return null;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const cx = v.x + (shown.x + shown.width / 2) * v.k;
    const top = v.y + shown.y * v.k;
    const bottom = v.y + (shown.y + shown.height) * v.k;
    const left = Math.max(CARD_GAP, Math.min(cx - CARD_WIDTH / 2, w - CARD_WIDTH - CARD_GAP));
    return (top + bottom) / 2 < h / 2 ? { left, top: bottom + CARD_GAP } : { left, bottom: h - top + CARD_GAP };
  })();

  /** The search box's pick: centred, names readable, and their card open. */
  const found = (id: string) => {
    const p = layout?.people.find((x) => x.id === id);
    if (!p) return;
    centre(p, Math.max(v.k, OPEN_AT_LEAST));
    setSelected(id);
  };

  return (
    <div className="flex h-full min-w-0 flex-col">
      <ViewHeader
        title={focusId ? t.family_tree.focus_title(focusTitle ?? "…") : t.views["family-tree"]}
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
      {data && (ready || focusId) && (
        <div
          data-testid="family-tree-toolbar"
          className="flex min-w-0 shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-3 py-1.5"
        >
          {ready && <TreeSearch people={layout.people} onPick={found} />}
          {focusId && (
            <>
              <GenerationsSelect which="up" value={up} onChange={(g) => setGenerations("up", g)} />
              <GenerationsSelect which="down" value={down} onChange={(g) => setGenerations("down", g)} />
              <Button
                size="sm"
                variant="outline"
                className="h-auto min-h-7 min-w-0 whitespace-normal text-xs"
                data-testid="family-tree-everyone"
                onClick={() => s.navigate({ kind: "family-tree" })}
              >
                {t.family_tree.everyone}
              </Button>
            </>
          )}
        </div>
      )}
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
      ) : !ready && focusId ? (
        <div
          className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
          data-testid="family-tree-no-kin"
        >
          <Network className="size-6 shrink-0 text-muted-foreground" />
          <p className="max-w-sm text-sm text-muted-foreground">
            {focusTitle ? t.family_tree.no_kin(focusTitle) : t.family_tree.gone}
          </p>
        </div>
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
        <div className="relative min-h-0 min-w-0 flex-1">
          <div
            ref={(el) => {
              box.current = el;
            }}
            data-testid="family-tree"
            data-zoom={v.k.toFixed(3)}
            data-x={v.x.toFixed(1)}
            data-y={v.y.toFixed(1)}
            data-names={names ? "shown" : "hidden"}
            data-families={layout.families}
            data-focus={focusId}
            data-up={focusId ? up : undefined}
            data-down={focusId ? down : undefined}
            className="absolute inset-0 cursor-grab overflow-hidden active:cursor-grabbing"
            // The browser must not take the drag for scrolling or its own zoom.
            style={{ touchAction: "none" }}
            {...pz.handlers}
            onClick={(e) => {
              // A click on the background, not the end of a drag, closes the card.
              if (pz.dragged()) return;
              if (!(e.target as Element).closest("[data-testid=family-tree-person]")) setSelected(null);
            }}
          >
            <svg className="absolute inset-0 size-full select-none" aria-label={t.views["family-tree"]}>
              <g transform={`translate(${v.x},${v.y}) scale(${v.k})`}>{drawing}</g>
            </svg>
          </div>
          {shown && cardAt && (
            <PersonCard
              key={shown.id}
              person={shown}
              at={cardAt}
              isFocus={shown.id === focusId}
              onFocus={() => refocus(shown.id)}
              onOpen={(other) => {
                setSelected(null);
                s.openDoc(shown.id, other);
              }}
              onClose={() => setSelected(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}
