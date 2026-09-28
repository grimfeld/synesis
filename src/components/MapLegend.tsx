// The Map's legend (PLAN §27.14): the kinds on screen, what colour means right
// now, and the Journeys drawn. A card over the map's bottom-left corner, open
// on desktop and a chip on a phone; each Device remembers which it prefers.
import { useState } from "react";
import { ListTree, X } from "lucide-react";
import { colorToken, type ColorBy, type KindDef } from "@/lib/map";
import { pinIcon } from "@/lib/pinIcons";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";

const KEY = "synesis.mapLegend";

function initiallyOpen(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "open") return true;
    if (v === "closed") return false;
  } catch {
    /* preference only */
  }
  return typeof window === "undefined" || window.innerWidth >= 640;
}

/** A pin in miniature: the kind's glyph on a disc of the given colour. */
function Swatch({ kind, color }: { kind: KindDef | null; color: string }) {
  const Icon = kind ? pinIcon(kind.icon) : null;
  return (
    <span
      className="flex size-4 shrink-0 items-center justify-center rounded-full text-white ring-1 ring-background"
      style={{ background: color }}
      aria-hidden="true"
    >
      {Icon ? <Icon className="size-2.5" strokeWidth={2.5} /> : <span className="size-1.5 rounded-full bg-white" />}
    </span>
  );
}

function Row({ children, testid }: { children: React.ReactNode; testid?: string }) {
  return (
    <li data-testid={testid} className="flex min-w-0 items-center gap-2 text-xs">
      {children}
    </li>
  );
}

export function MapLegend({
  kinds,
  plain,
  other,
  colorBy,
  colored,
  onUncolor,
  journeys,
  fillable,
  onFill,
}: {
  kinds: KindDef[];
  /** Some Place on screen has no kind the app knows. */
  plain: boolean;
  /** Some Place on screen is outside the chosen values. */
  other: boolean;
  colorBy: ColorBy;
  colored: { value: string; name: string }[];
  onUncolor: (value: string) => void;
  journeys: { id: string; title: string; token: string }[];
  /** Places the gazetteer could give a kind (PLAN §27.13). */
  fillable: number;
  onFill: () => void;
}) {
  const t = useT();
  const [open, setOpenState] = useState(initiallyOpen);
  const setOpen = (b: boolean) => {
    setOpenState(b);
    try {
      localStorage.setItem(KEY, b ? "open" : "closed");
    } catch {
      /* preference only */
    }
  };
  const kindName = (k: KindDef) => k.label ?? t.place_kind[k.name] ?? k.name;
  // Under "Kind", shape and colour say the same thing, so one list covers both.
  const byKind = colorBy === "kind";
  const kindColor = (k: KindDef) => (byKind ? `var(${k.token})` : "var(--muted-foreground)");
  const plainColor = byKind ? "var(--c-place)" : "var(--muted-foreground)";
  const comparing = colorBy === "tag" || colorBy === "book";

  if (!open)
    return (
      <Button
        size="sm"
        variant="outline"
        data-testid="map-legend-open"
        className="absolute bottom-3 left-3 z-[1000] min-h-8 h-auto bg-popover/95 shadow-md"
        onClick={() => setOpen(true)}
      >
        <ListTree />
        {t.map_legend}
      </Button>
    );

  return (
    <section
      data-testid="map-legend"
      aria-label={t.map_legend}
      className="absolute bottom-3 left-3 z-[1000] flex max-h-[calc(100%-1.5rem)] w-56 max-w-[calc(100%-1.5rem)] flex-col gap-2 overflow-y-auto rounded-xl border bg-popover/95 p-3 text-popover-foreground shadow-md backdrop-blur-sm"
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h2 className="min-w-0 text-xs font-semibold">{t.map_legend}</h2>
        <Button
          size="icon"
          variant="ghost"
          className="size-6 shrink-0"
          aria-label={t.map_legend_hide}
          data-testid="map-legend-close"
          onClick={() => setOpen(false)}
        >
          <X />
        </Button>
      </div>

      {(kinds.length > 0 || plain) && (
        <div className="min-w-0">
          <h3 className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">{t.map_legend_kinds}</h3>
          <ul className="grid gap-1">
            {kinds.map((k) => (
              <Row key={k.name} testid="map-legend-kind">
                {k.name === "region" ? (
                  // A region has no pin (§27.11): its key is the way its name is set.
                  <span
                    className="w-4 shrink-0 text-center text-[9px] font-semibold uppercase tracking-widest"
                    style={{ color: kindColor(k) }}
                    aria-hidden="true"
                  >
                    Aa
                  </span>
                ) : (
                  <Swatch kind={k} color={kindColor(k)} />
                )}
                <span className="min-w-0 truncate">{kindName(k)}</span>
              </Row>
            ))}
            {plain && (
              <Row testid="map-legend-kind">
                <Swatch kind={null} color={plainColor} />
                <span className="min-w-0 truncate">{t.place_kind_none}</span>
              </Row>
            )}
          </ul>
          {fillable > 0 && (
            <Button
              size="sm"
              variant="link"
              data-testid="map-fill-kinds"
              className="h-auto min-h-6 whitespace-normal p-0 text-left text-xs"
              onClick={onFill}
            >
              {t.fill_kinds_short(fillable)}
            </Button>
          )}
        </div>
      )}

      {comparing && (
        <div className="min-w-0">
          <h3 className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            {t.map_legend_colour} · {t.map_color_by_opts[colorBy]}
          </h3>
          {colored.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t.map_color_pick}</p>
          ) : (
            <ul className="grid gap-1">
              {colored.map((c, i) => (
                <Row key={c.value} testid="map-legend-color">
                  <span className="size-3 shrink-0 rounded-full" style={{ background: `var(${colorToken(i)})` }} />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <button
                    type="button"
                    className="shrink-0 rounded text-muted-foreground hover:text-foreground"
                    aria-label={t.map_color_remove(c.name)}
                    data-testid="map-legend-uncolor"
                    onClick={() => onUncolor(c.value)}
                  >
                    <X className="size-3.5" />
                  </button>
                </Row>
              ))}
              {other && (
                <Row>
                  <span className="size-3 shrink-0 rounded-full opacity-60" style={{ background: "var(--c-place-muted)" }} />
                  <span className="min-w-0 truncate text-muted-foreground">{t.map_color_other}</span>
                </Row>
              )}
            </ul>
          )}
        </div>
      )}

      {journeys.length > 0 && (
        <div className="min-w-0">
          <h3 className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">{t.map_filter_journeys}</h3>
          <ul className="grid gap-1">
            {journeys.map((j) => (
              <Row key={j.id} testid="map-legend-journey">
                <span className="h-0.5 w-4 shrink-0 rounded-full" style={{ background: `var(${j.token})` }} />
                <span className="min-w-0 truncate">{j.title}</span>
              </Row>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
