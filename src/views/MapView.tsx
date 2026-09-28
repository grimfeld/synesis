import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { MapPin, Plus, Search } from "lucide-react";
import {
  api,
  type DocSummary,
  type Journey,
  type PlaceFact,
} from "@/lib/api";
import {
  activeCount,
  bezierLeg,
  filterPlaces,
  hasPin,
  hiddenLabels,
  kindCatalogue,
  kindOf,
  labelStyle,
  legendKinds,
  pinPaint,
  placeBooks,
  placeTags,
  routePoints,
  routeToken,
  splitWedges,
  type KindDef,
  type LabelBox,
  type PinBox,
  type PinPaint,
  type PlaceFacts,
  type RoutePoint,
} from "@/lib/map";
import { pinIconSvg } from "@/lib/pinIcons";
import { useQuery } from "@/lib/useQuery";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";
import { ViewHeader } from "@/components/ViewHeader";
import { MapFilters } from "@/components/MapFilters";
import { MapLegend } from "@/components/MapLegend";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** A pin's diameter in CSS pixels (PLAN §27.8). */
const PIN = 22;

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * One Place as Leaflet draws it: a round badge carrying the kind's glyph on
 * the rule's colour (split into wedges when several apply), the Stop numbers
 * in a small badge on its edge, and the name set in the atlas style of its
 * kind. A region is an area and has no pin, only its name (§27.11) — unless
 * a Journey stops there, because a Stop's number needs somewhere to sit.
 */
function placeHtml(o: {
  id: string;
  title: string;
  kind: KindDef | null;
  colors: string[];
  paint: PinPaint;
  stops: number[] | undefined;
  stopColor: string | undefined;
}): string {
  const style = labelStyle(o.kind);
  const pinned = hasPin(o.kind) || !!o.stops;
  const classes = [
    "map-place",
    `map-place--${style}`,
    pinned ? "has-pin" : "no-pin",
    o.paint.muted ? "is-muted" : "",
    o.stops ? "is-stop" : "",
  ].filter(Boolean);
  const wedges = splitWedges(o.colors.length, PIN / 2)
    .map((d, i) => `<path d="${d}" fill="${esc(o.colors[i])}"/>`)
    .join("");
  const glyph = o.kind ? pinIconSvg(o.kind.icon, 13) : `<span class="map-pin-dot"></span>`;
  const pin = pinned
    ? `<span class="map-pin"><svg class="map-pin-disc" width="${PIN}" height="${PIN}" viewBox="0 0 ${PIN} ${PIN}" aria-hidden="true">${wedges}</svg>` +
      `<span class="map-pin-glyph">${glyph}</span>` +
      (o.paint.more ? `<span class="map-pin-more">+</span>` : "") +
      (o.stops
        ? `<span class="map-pin-stop" data-testid="map-stop-number" style="background:${esc(o.stopColor ?? o.colors[0])}">${o.stops.join("·")}</span>`
        : "") +
      `</span>`
    : "";
  return (
    `<div class="${classes.join(" ")}" data-testid="map-pin" data-id="${esc(o.id)}" data-kind="${esc(o.kind?.name ?? "")}" ` +
    `data-colors="${o.paint.tokens.join(" ")}" style="--pin:${esc(o.colors[0])}">` +
    pin +
    `<span class="map-name">${esc(o.title)}</span></div>`
  );
}

/** Read a CSS custom property, so routes follow the theme like every colour. */
function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

/**
 * Hide the names that would overlap, least-mentioned first, and never a
 * Stop's (PLAN §27.10). Measured from the DOM because a name's width depends
 * on its font, its kind's style and the Text scale.
 */
function relabelIn(
  places: { id: string; title: string; el: () => HTMLElement | undefined; weight: number; pinned: boolean }[],
) {
  const boxes: LabelBox[] = [];
  const pins: PinBox[] = [];
  const names = new Map<string, HTMLElement>();
  for (const p of places) {
    // Every pin is an obstacle a name must not cover, and is never hidden itself.
    const pin = p.el()?.querySelector<HTMLElement>(".map-pin");
    if (pin) {
      const r = pin.getBoundingClientRect();
      pins.push({ id: p.id, x: r.left, y: r.top, w: r.width, h: r.height, weight: p.weight, pinned: p.pinned, title: p.title });
    }
    const name = p.el()?.querySelector<HTMLElement>(".map-name");
    if (!name) continue;
    const r = name.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    names.set(p.id, name);
    boxes.push({ id: p.id, x: r.left, y: r.top, w: r.width, h: r.height, weight: p.weight, pinned: p.pinned, title: p.title });
  }
  const hidden = hiddenLabels(boxes, pins);
  for (const [id, el] of names) el.classList.toggle("is-hidden", hidden.has(id));
}

export function MapView() {
  const s = useStore();
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const relabel = () => relabelIn(drawnPlaces.current);
  const layer = useRef<L.LayerGroup | null>(null);
  // The drawn Places, so labels can be re-laid-out on zoom without a redraw.
  const drawnPlaces = useRef<{ id: string; title: string; el: () => HTMLElement | undefined; weight: number; pinned: boolean }[]>([]);
  // Opening a Place must not re-run the marker effect: the store object changes
  // on every update, and a re-run would refit the view under the reader.
  const openDoc = useRef(s.openDoc);
  openDoc.current = s.openDoc;
  // Fit once per set of Places; after that the view is the reader's to keep.
  const fitted = useRef("");

  // Three reads, three answers about what is stale. A Place's own page moves
  // the markers; a Journey's moves the routes; but the Book a Place is
  // mentioned in is counted from every document in the vault, so the facts
  // behind the filters move whenever anything is written.
  const { data: placesData } = useQuery<DocSummary[]>({
    key: [],
    deps: { types: ["place"] },
    fetch: () => api.places(),
  });
  const { data: factsData } = useQuery<PlaceFact[]>({
    key: [],
    deps: { any: true },
    fetch: () => api.placeFacts(),
  });
  const { data: journeysData } = useQuery<Journey[]>({
    key: [],
    deps: { types: ["journey"] },
    fetch: () => api.journeys(),
  });
  const places = useMemo(() => placesData ?? [], [placesData]);
  const rawFacts = useMemo(() => factsData ?? [], [factsData]);
  const journeys = useMemo(() => journeysData ?? [], [journeysData]);

  // The engine returns one row per Place; the filters want lookups by id.
  const facts: PlaceFacts = useMemo(() => {
    const f: PlaceFacts = {
      tags: new Map(),
      books: new Map(),
      mentions: new Map(),
    };
    for (const r of rawFacts) {
      f.tags.set(r.doc, r.tags);
      f.books.set(r.doc, r.books);
      f.mentions.set(r.doc, r.mentions);
    }
    return f;
  }, [rawFacts]);

  // The kinds this Vault knows, and each Place's kind as the Map draws it.
  const catalogue = useMemo(() => kindCatalogue(s.placeKinds), [s.placeKinds]);
  const kindById = useMemo(() => {
    const m = new Map<string, KindDef | null>();
    for (const r of rawFacts) m.set(r.doc, kindOf(r.kind, catalogue));
    return m;
  }, [rawFacts, catalogue]);

  const mf = s.mapFilters;
  const filteredPlaces = useMemo(
    () => filterPlaces(places, mf, facts),
    [places, mf, facts],
  );

  // The Journeys being drawn, in the order their chips were offered, so a
  // Journey keeps its colour as others are switched on and off.
  const drawn = useMemo(
    () => journeys.filter((j) => mf.journeys.includes(j.doc.id)),
    [journeys, mf.journeys],
  );
  const routes = useMemo(
    () =>
      drawn.map((j, i) => ({
        id: j.doc.id,
        title: j.doc.title,
        color: routeToken(journeys.findIndex((x) => x.doc.id === j.doc.id) || i),
        points: routePoints(j.stops),
      })),
    [drawn, journeys],
  );

  // A Journey that is on shows every Stop it can draw, whatever the other
  // filters say (PLAN §19.7): the filters ask "which Places am I browsing?",
  // a route chip asks "draw me this".
  const shown = useMemo(() => {
    const byId = new Map(filteredPlaces.map((p) => [p.id, p]));
    for (const r of routes)
      for (const pt of r.points) {
        if (byId.has(pt.id)) continue;
        const p = places.find((x) => x.id === pt.id);
        if (p) byId.set(p.id, p);
      }
    return [...byId.values()];
  }, [filteredPlaces, routes, places]);

  // Stops belong to a route, so they wear its colour rather than the Place one.
  const routeColorOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of routes) for (const pt of r.points) m.set(pt.id, r.color);
    return m;
  }, [routes]);
  const numbersOf = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const r of routes)
      for (const pt of r.points)
        m.set(pt.id, [...(m.get(pt.id) ?? []), pt.n]);
    return m;
  }, [routes]);

  const tagChips = useMemo(() => placeTags(places, facts), [places, facts]);
  const bookChips = useMemo(() => placeBooks(places, facts), [places, facts]);
  const journeyChips = useMemo(
    () => journeys.map((j) => ({ id: j.doc.id, title: j.doc.title })),
    [journeys],
  );
  const filtered = activeCount(mf) > 0;

  // What the legend explains: the kinds on screen, what colour means now, and
  // the routes drawn (PLAN §27.14).
  const bookName = (n: number) => s.books.find((b) => b.number === n)?.name ?? String(n);
  const legend = useMemo(() => {
    const onScreen = shown.filter((p) => p.lat != null && p.lon != null);
    const { kinds, plain } = legendKinds(
      onScreen.map((p) => kindById.get(p.id) ?? null),
      catalogue,
    );
    const comparing = (mf.colorBy === "tag" || mf.colorBy === "book") && mf.colored.length > 0;
    const other =
      comparing &&
      onScreen.some(
        (p) => !routeColorOf.has(p.id) && pinPaint(p.id, null, mf.colorBy, mf.colored, facts).muted,
      );
    return { kinds, plain, other };
  }, [shown, kindById, catalogue, mf.colorBy, mf.colored, routeColorOf, facts]);

  useEffect(() => {
    if (!host.current || map.current) return;
    map.current = L.map(host.current, { center: [31.8, 35.2], zoom: 6, zoomControl: true });
    // The current view, for tests: tiles are unreliable offline, this is not.
    const mark = () => {
      const m = map.current;
      const el = host.current;
      if (!m || !el) return;
      const c = m.getCenter();
      el.dataset.zoom = String(m.getZoom());
      el.dataset.center = `${c.lat.toFixed(3)},${c.lng.toFixed(3)}`;
    };
    map.current.on("moveend zoomend", mark);
    mark();
    map.current.on("zoomend", () => relabel());
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap" }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    // Leaflet only measures its box on a window resize; the Tutorial panel
    // docking beside the Map, or the sidebar closing, changes it without one.
    const ro = new ResizeObserver(() => {
      map.current?.invalidateSize();
      relabel();
    });
    ro.observe(host.current);
    return () => {
      ro.disconnect();
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Markers and routes carry resolved colours: redraw when the Skin changes.
  const [skinTick, setSkinTick] = useState(0);
  useEffect(() => {
    const on = () => setSkinTick((n) => n + 1);
    window.addEventListener("skin:applied", on);
    return () => window.removeEventListener("skin:applied", on);
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const placeColor = cssVar("--c-place", "#c04f6b");
    const pts: L.LatLngTuple[] = [];

    const halo = cssVar("--c-atlas-land", cssVar("--background", "#ffffff"));

    // Routes first, so markers sit on top of their own lines.
    for (const r of routes) {
      const color = cssVar(r.color, placeColor);
      for (let i = 0; i + 1 < r.points.length; i++) {
        const leg = bezierLeg(r.points[i].at, r.points[i + 1].at);
        // A halo in the land colour, so the route reads on shaded relief.
        L.polyline(leg, { color: halo, weight: 6, opacity: 0.7, interactive: false }).addTo(g);
        L.polyline(leg, {
          color,
          weight: 2.5,
          opacity: 0.9,
          className: "map-route",
        })
          .bindTooltip(r.title, { sticky: true })
          .addTo(g);
        // An arrowhead near the end of the leg, for direction at a glance.
        const a = leg[Math.floor(leg.length * 0.6)];
        const b = leg[Math.floor(leg.length * 0.6) + 1];
        if (a && b) {
          const angle = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI;
          L.marker(a, {
            interactive: false,
            icon: L.divIcon({
              className: "map-arrow",
              html: `<span style="--a:${-angle}deg;--c:${color}"></span>`,
              iconSize: [10, 10],
            }),
          }).addTo(g);
        }
      }
    }

    const placed: typeof drawnPlaces.current = [];
    for (const p of shown) {
      if (p.lat == null || p.lon == null) continue;
      const kind = kindById.get(p.id) ?? null;
      const route = routeColorOf.get(p.id);
      // A Stop on a drawn Journey wears the route's colour under every rule
      // (§27.7): the route is the most specific thing the reader asked for.
      const paint: PinPaint = route
        ? { tokens: [route], more: false, muted: false }
        : pinPaint(p.id, kind, mf.colorBy, mf.colored, facts);
      const colors = paint.tokens.map((tk) => cssVar(tk, placeColor));
      // Numbered when a route passes through: the number is the Stop's position
      // in the whole route, and a Place visited twice carries both (§19.10).
      const stops = numbersOf.get(p.id);
      const mk = L.marker([p.lat, p.lon], {
        icon: L.divIcon({
          className: "map-place-icon",
          html: placeHtml({ id: p.id, title: p.title, kind, colors, paint, stops, stopColor: route ? cssVar(route, placeColor) : undefined }),
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        }),
        title: p.title,
        alt: p.title,
        riseOnHover: true,
        keyboard: true,
        // Stops on top, muted pins underneath, and otherwise the more a Place
        // is mentioned the higher it sits, so Jerusalem covers Gethsemane
        // rather than the other way round when they touch.
        zIndexOffset: paint.muted ? -2000 : stops ? 2000 : Math.min(facts.mentions.get(p.id) ?? 0, 1000),
      }).addTo(g);
      mk.on("click", () => openDoc.current(p.id));
      mk.on("keypress", (e: L.LeafletKeyboardEvent) => {
        if (e.originalEvent.key === "Enter") openDoc.current(p.id);
      });
      placed.push({
        id: p.id,
        title: p.title,
        el: () => mk.getElement(),
        weight: facts.mentions.get(p.id) ?? 0,
        pinned: !!stops,
      });
      pts.push([p.lat, p.lon]);
    }
    drawnPlaces.current = placed;
    const key = pts.map(([a, b]) => `${a},${b}`).join(";");
    if (pts.length && fitted.current !== key) {
      fitted.current = key;
      m.fitBounds(L.latLngBounds(pts).pad(0.3), { maxZoom: 9 });
    }
    // After layout: names need their final boxes to be measured.
    requestAnimationFrame(() => relabelIn(drawnPlaces.current));
  }, [shown, routes, routeColorOf, numbersOf, skinTick, kindById, mf.colorBy, mf.colored, facts]);

  return (
    <div className="flex h-full flex-col">
      <ViewHeader title={t.views.map} icon={<MapPin />} tutorials={{ kind: "map" }}>
        <span className="hidden truncate text-xs text-muted-foreground md:inline">{places.length === 0 ? t.no_places : t.map_hint}</span>
        <div className="ml-auto flex items-center gap-1">
          <div className="relative hidden lg:block">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              data-testid="map-search"
              value={mf.search}
              onChange={(e) =>
                s.setMapFilters({ ...mf, search: e.currentTarget.value })
              }
              placeholder={t.map_filter_search}
              className="h-8 w-40 pl-7 text-xs"
            />
          </div>
          <MapFilters
            filters={mf}
            onChange={s.setMapFilters}
            tags={tagChips}
            books={bookChips}
            journeys={journeyChips}
            bookName={bookName}
          />
          <Button size="sm" variant="outline" onClick={() => s.setDialog({ kind: "new", type: "place" })}>
            <Plus />
            {t.types.place}
          </Button>
        </div>
      </ViewHeader>
      <div className="relative min-h-0 flex-1">
        <div data-testid="map" ref={host} className="size-full" />
        {shown.length > 0 && (
          <MapLegend
            kinds={legend.kinds}
            plain={legend.plain}
            other={legend.other}
            colorBy={mf.colorBy}
            colored={mf.colored.map((v) => ({
              value: v,
              name: mf.colorBy === "book" ? bookName(Number(v)) : v,
            }))}
            onUncolor={(v) =>
              s.setMapFilters({ ...mf, colored: mf.colored.filter((x) => x !== v) })
            }
            journeys={routes.map((r) => ({ id: r.id, title: r.title, token: r.color }))}
          />
        )}
        {places.length > 0 && shown.length === 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-1/3 z-[1000] flex flex-col items-center gap-3 px-8 text-center">
            <p data-testid="map-empty" className="text-sm text-muted-foreground">
              {t.map_filtered_empty}
            </p>
            {filtered && (
              <Button
                size="sm"
                variant="outline"
                className="pointer-events-auto"
                data-testid="map-empty-clear"
                onClick={() =>
                  s.setMapFilters({
                    ...mf,
                    tags: [],
                    books: [],
                    search: "",
                    mentionedOnly: false,
                  })
                }
              >
                {t.tl_filter_clear}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export type { RoutePoint };
