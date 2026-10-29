import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { MapPin, Plus, Search, Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type DatedProperty,
  type DocSummary,
  type EventLink,
  type Journey,
  type KindSuggestion,
  type LatLon,
  type PlaceFact,
  type PlaceTie,
  type RegionMember,
} from "@/lib/api";
import { addCorner, canClose, editableCorners, isRegion } from "@/lib/border";
import { useBorders, useDeleteBorder } from "@/lib/useBorders";
import { useFillKinds } from "@/lib/fillKinds";
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
import { mapInPeriod, type EventMark } from "@/lib/mapPeriod";
import { NO_PERIOD_FILTER, ordered } from "@/lib/period";
import { sliderExtent } from "@/lib/periodSlider";
import { yearOf } from "@/lib/timeline";
import { addAtlas, removeMap, type Atlas } from "@/lib/atlas";
import { useQuery } from "@/lib/useQuery";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";
import { ViewHeader } from "@/components/ViewHeader";
import { MapFilters } from "@/components/MapFilters";
import { MapLegend } from "@/components/MapLegend";
import { PeriodBar } from "@/components/PeriodBar";
import { PeriodSlider } from "@/components/PeriodSlider";
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
  // Region Borders, under the routes and pins (ADR 0023), and the one being drawn.
  const bordersLayer = useRef<L.LayerGroup | null>(null);
  const draftLayer = useRef<L.LayerGroup | null>(null);
  const atlas = useRef<Atlas | null>(null);
  // The drawn Places, so labels can be re-laid-out on zoom without a redraw.
  const drawnPlaces = useRef<{ id: string; title: string; el: () => HTMLElement | undefined; weight: number; pinned: boolean }[]>([]);
  // Opening a Place must not re-run the marker effect: the store object changes
  // on every update, and a re-run would refit the view under the reader.
  const openDoc = useRef(s.openDoc);
  openDoc.current = s.openDoc;
  // While a Border is being drawn, a click on a pin must not leave the Map.
  const drawingRef = useRef(false);
  drawingRef.current = !!s.borderDraw;
  // Fit once per set of Places; after that the view is the reader's to keep.
  const fitted = useRef("");
  // A Place's pin card (CONTEXT.md: Map): in a Period, a click on a pin opens
  // it, listing the Characters there then; without one, a click opens the Hub.
  const [pinCard, setPinCard] = useState<{
    id: string;
    left: number;
    top?: number;
    bottom?: number;
  } | null>(null);
  const periodOn = useRef(false);
  periodOn.current = !!ordered(s.periodFilter.period);
  const openPin = useRef<(id: string) => void>(() => {});
  openPin.current = (id: string) => {
    if (drawingRef.current) return;
    const m = map.current;
    const el = host.current;
    const p = placesById.current.get(id);
    if (!periodOn.current || !m || !el || !p || p.lat == null || p.lon == null) {
      openDoc.current(id);
      return;
    }
    const at = m.latLngToContainerPoint([p.lat, p.lon]);
    const w = el.clientWidth;
    const h = el.clientHeight;
    const CARD = 256;
    const left = Math.max(8, Math.min(at.x - CARD / 2, w - CARD - 8));
    // Below the pin in the top half, above it in the bottom half.
    setPinCard(
      at.y < h / 2
        ? { id, left, top: at.y + 16 }
        : { id, left, bottom: h - at.y + 16 },
    );
  };
  const placesById = useRef(new Map<string, DocSummary>());

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
  // The Period (CONTEXT.md) needs every Date, which Place each Event names,
  // and who is in which Place, so it can keep what overlaps it, mark Events at
  // their Place, and say who is there.
  const { data: datedData } = useQuery<{
    rows: DatedProperty[];
    links: EventLink[];
    ties: PlaceTie[];
    members: RegionMember[];
  }>({
    key: [],
    deps: { any: true },
    fetch: async () => {
      // `members`: the Places inside each region's Border, so a chosen region
      // takes them in (ADR 0023).
      const [rows, links, ties, members] = await Promise.all([
        api.timeline(),
        api.eventLinks(),
        api.placeTies(),
        api.regions(),
      ]);
      return { rows, links, ties, members };
    },
  });
  // Places the gazetteer could give a kind (PLAN §27.13), for the legend's offer.
  const { data: fillableData } = useQuery<KindSuggestion[]>({
    key: [],
    deps: { types: ["place"] },
    fetch: () => api.kindSuggestions(),
  });
  const fillKinds = useFillKinds();
  const borders = useBorders();
  const places = useMemo(() => placesData ?? [], [placesData]);
  placesById.current = new Map(places.map((p) => [p.id, p]));
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
  const pf = s.periodFilter;
  // The shared Tags, asked for by Tag: a Place carries one, or someone tied
  // to it does (lib/period).
  const { data: taggedData } = useQuery({
    key: [pf.tags.join(" ")],
    deps: { any: true },
    enabled: pf.tags.length > 0,
    fetch: async () => {
      const lists = await Promise.all(pf.tags.map((tg) => api.taggedDocuments(tg)));
      return pf.tags.map((tag, i) => ({ tag, docs: lists[i] }));
    },
  });
  const tagsByDoc = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const { tag, docs } of pf.tags.length > 0 ? (taggedData ?? []) : [])
      for (const d of docs) m.set(d.id, [...(m.get(d.id) ?? []), tag]);
    return m;
  }, [taggedData, pf.tags]);
  // The Period the Timeline shares: Places and Journeys that overlap it, and
  // the Events in it, marked at their Place (lib/mapPeriod).
  const rows = datedData?.rows;
  // Regions with a Border and no pin: the Period alone decides their Border.
  const unpinnedRegions = useMemo(() => {
    const located = new Set(places.map((p) => p.id));
    return borders
      .filter((b) => !located.has(b.doc))
      .map((b) => s.docsById.get(b.doc))
      .filter((d): d is DocSummary => !!d);
  }, [borders, places, s.docsById]);
  const inPeriod = useMemo(
    () =>
      mapInPeriod({
        places,
        regions: unpinnedRegions,
        journeys,
        events: s.docs.filter((d) => d.type === "event"),
        characters: s.docs.filter((d) => d.type === "character"),
        rows: rows ?? [],
        eventLinks: datedData?.links ?? [],
        placeTies: datedData?.ties ?? [],
        regionMembers: datedData?.members ?? [],
        period: pf.period,
        tags: pf.tags,
        chosenPlaces: pf.places,
        tagsByDoc,
      }),
    [places, unpinnedRegions, journeys, s.docs, rows, datedData, pf, tagsByDoc],
  );
  // The slider's track: every year the Vault's Dates name, as the Timeline's.
  const extent = useMemo(
    () => sliderExtent((rows ?? []).filter((r) => r.date).map((r) => yearOf(r.date!))),
    [rows],
  );
  const filteredPlaces = useMemo(
    () => filterPlaces(inPeriod.places, mf, facts),
    [inPeriod.places, mf, facts],
  );
  // What the view fits to: the Places the Map's own filters keep, whatever the
  // Period. Dragging the slider then never moves the map under the reader.
  const fitTo = useMemo(
    () =>
      filterPlaces(places, mf, facts)
        .filter((p) => p.lat != null && p.lon != null)
        .map((p) => [p.lat!, p.lon!] as L.LatLngTuple),
    [places, mf, facts],
  );

  // The Journeys being drawn, in the order their chips were offered, so a
  // Journey keeps its colour as others are switched on and off. A Journey
  // outside the Period is not drawn, and not offered.
  const drawn = useMemo(
    () => inPeriod.journeys.filter((j) => mf.journeys.includes(j.doc.id)),
    [inPeriod.journeys, mf.journeys],
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
    () => inPeriod.journeys.map((j) => ({ id: j.doc.id, title: j.doc.title })),
    [inPeriod.journeys],
  );
  const filtered =
    activeCount(mf) + pf.tags.length + pf.places.length > 0 || pf.period != null;

  // Event marks at the Places on screen, numbered per Place so they stack.
  const marks = useMemo(() => {
    const on = new Set(shown.map((p) => p.id));
    return inPeriod.events.filter((m: EventMark) => on.has(m.place));
  }, [inPeriod.events, shown]);

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
    // The card points at its pin: once the map moves, or is clicked, it goes.
    map.current.on("movestart zoomstart click", () => setPinCard(null));
    mark();
    // Names are measured, so measure again whenever their boxes can have
    // moved: a zoom, the end of an animated fit, and the web font arriving.
    map.current.on("zoomend moveend", () => relabel());
    document.fonts?.ready.then(() => relabel()).catch(() => {});
    atlas.current = addAtlas(map.current);
    bordersLayer.current = L.layerGroup().addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    draftLayer.current = L.layerGroup().addTo(map.current);
    // Leaflet only measures its box on a window resize; the Tutorial panel
    // docking beside the Map, or the sidebar closing, changes it without one.
    const ro = new ResizeObserver(() => {
      map.current?.invalidateSize();
      relabel();
    });
    ro.observe(host.current);
    return () => {
      ro.disconnect();
      if (map.current) removeMap(map.current);
      map.current = null;
    };
  }, []);

  // Markers and routes carry resolved colours: redraw when the Skin changes.
  const [skinTick, setSkinTick] = useState(0);
  useEffect(() => {
    const on = () => {
      atlas.current?.restyle();
      setSkinTick((n) => n + 1);
    };
    window.addEventListener("skin:applied", on);
    return () => window.removeEventListener("skin:applied", on);
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const placeColor = cssVar("--c-place", "#c04f6b");

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
      mk.on("click", () => openPin.current(p.id));
      mk.on("keypress", (e: L.LeafletKeyboardEvent) => {
        if (e.originalEvent.key === "Enter") openPin.current(p.id);
      });
      placed.push({
        id: p.id,
        title: p.title,
        el: () => mk.getElement(),
        weight: facts.mentions.get(p.id) ?? 0,
        pinned: !!stops,
      });
    }
    drawnPlaces.current = placed;

    // Events in the Period, as diamonds beside their Place's pin.
    const byId = new Map(shown.map((p) => [p.id, p]));
    const stacked = new Map<string, number>();
    for (const mk of marks) {
      const p = byId.get(mk.place);
      if (!p || p.lat == null || p.lon == null) continue;
      const i = stacked.get(p.id) ?? 0;
      stacked.set(p.id, i + 1);
      const ev = L.marker([p.lat, p.lon], {
        icon: L.divIcon({
          className: "map-event-icon",
          html: `<span class="map-event" data-testid="map-event" data-id="${esc(mk.event.id)}" data-place="${esc(p.id)}" style="--i:${i}"></span>`,
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        }),
        title: mk.event.title,
        alt: mk.event.title,
        keyboard: true,
        zIndexOffset: 3000,
      })
        .bindTooltip(mk.event.title, { direction: "top", offset: [-12, -14 - i * 11] })
        .addTo(g);
      ev.on("click", () => openDoc.current(mk.event.id));
      ev.on("keypress", (e: L.LeafletKeyboardEvent) => {
        if (e.originalEvent.key === "Enter") openDoc.current(mk.event.id);
      });
    }
    // Stops of a drawn route count too, as they always have.
    const fit = [...fitTo, ...routes.flatMap((r) => r.points.map((pt) => pt.at as L.LatLngTuple))];
    const key = fit.map(([a, b]) => `${a},${b}`).join(";");
    if (fit.length && fitted.current !== key) {
      fitted.current = key;
      m.fitBounds(L.latLngBounds(fit).pad(0.3), { maxZoom: 9 });
    }
    // After layout: names need their final boxes to be measured. Once more a
    // moment later, in case a fit was still animating the first time.
    requestAnimationFrame(() => relabelIn(drawnPlaces.current));
    const again = window.setTimeout(() => relabelIn(drawnPlaces.current), 400);
    return () => window.clearTimeout(again);
  }, [shown, marks, fitTo, routes, routeColorOf, numbersOf, skinTick, kindById, mf.colorBy, mf.colored, facts]);

  // ---- Borders (ADR 0023) ---------------------------------------------------
  // Drawn under the pins, in the region's own colour, for every region the
  // filters show. A region with no coordinates has no pin to be filtered by,
  // so its Border is always drawn, with its name at the middle.
  const draw = s.borderDraw;
  const regions = useMemo(
    () =>
      rawFacts
        .filter((r) => isRegion({ type: "place", kind: r.kind }))
        .map((r) => ({ id: r.doc, title: s.docsById.get(r.doc)?.title ?? r.doc }))
        .sort((a, b) => a.title.localeCompare(b.title)),
    [rawFacts, s.docsById],
  );
  const borderOf = useMemo(() => new Map(borders.map((b) => [b.doc, b])), [borders]);
  const drawing = draw?.placeId ?? null;
  const [corners, setCorners] = useState<LatLon[]>([]);
  const [closed, setClosed] = useState(false);
  const [saving, setSaving] = useState(false);
  // Start from the region's own Border when it can be edited corner by corner.
  // Only when the region changes: a refetch mid-drawing must not undo it.
  const borderOfRef = useRef(borderOf);
  borderOfRef.current = borderOf;
  useEffect(() => {
    const b = drawing ? borderOfRef.current.get(drawing) : undefined;
    const c = b ? editableCorners(b) : null;
    setCorners(c ?? []);
    setClosed(!!c);
  }, [drawing]);

  useEffect(() => {
    const g = bordersLayer.current;
    if (!g) return;
    g.clearLayers();
    const placeColor = cssVar("--c-place", "#c04f6b");
    const shownIds = new Set(shown.map((p) => p.id));
    const located = new Set(places.map((p) => p.id));
    const unpinnedIn = new Set(inPeriod.regions.map((r) => r.id));
    for (const b of borders) {
      if (b.status !== "ok" || b.doc === drawing) continue;
      if (located.has(b.doc) && !shownIds.has(b.doc)) continue;
      // Outside the Period, a region's Border goes with it (CONTEXT.md: Border).
      if (!located.has(b.doc) && !unpinnedIn.has(b.doc)) continue;
      const kind = kindById.get(b.doc) ?? null;
      const paint = pinPaint(b.doc, kind, mf.colorBy, mf.colored, facts);
      const color = cssVar(paint.tokens[0] ?? "--c-place", placeColor);
      const poly = L.polygon(b.polygons, {
        color,
        weight: 1.5,
        opacity: paint.muted ? 0.45 : 0.9,
        fillColor: color,
        fillOpacity: paint.muted ? 0.06 : 0.14,
        className: "map-border",
      }).addTo(g);
      const title = s.docsById.get(b.doc)?.title ?? b.doc;
      poly.bindTooltip(title, { sticky: true });
      poly.on("click", () => {
        if (!drawingRef.current) openDoc.current(b.doc);
      });
      const el = poly.getElement();
      el?.setAttribute("data-testid", "map-border");
      el?.setAttribute("data-id", b.doc);
      el?.setAttribute("data-color", paint.tokens[0] ?? "");
      if (!located.has(b.doc)) {
        L.marker(poly.getBounds().getCenter(), {
          interactive: false,
          icon: L.divIcon({
            className: "map-place-icon",
            html: `<div class="map-place map-place--region no-pin" data-testid="map-border-label" style="--pin:${esc(color)}"><span class="map-name">${esc(title)}</span></div>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          }),
        }).addTo(g);
      }
    }
  }, [borders, shown, places, inPeriod.regions, drawing, kindById, mf.colorBy, mf.colored, facts, skinTick, s.docsById]);

  // The Border being drawn: its outline so far and a handle on each corner.
  useEffect(() => {
    const g = draftLayer.current;
    if (!g) return;
    g.clearLayers();
    if (!drawing) return;
    const color = cssVar("--c-kind-region", cssVar("--c-place", "#c04f6b"));
    if (corners.length > 1) {
      const shape = closed
        ? L.polygon(corners, { color, weight: 2, fillColor: color, fillOpacity: 0.18, className: "map-border-draft", interactive: false })
        : L.polyline(corners, { color, weight: 2, dashArray: "4 4", className: "map-border-draft", interactive: false });
      shape.addTo(g);
      shape.getElement()?.setAttribute("data-testid", "map-border-draft");
    }
    corners.forEach((c, i) => {
      const mk = L.marker(c, {
        draggable: true,
        keyboard: false,
        zIndexOffset: 3000,
        icon: L.divIcon({
          className: `map-border-corner${i === 0 ? " is-first" : ""}`,
          html: `<span data-testid="border-corner" style="--c:${esc(color)}"></span>`,
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        }),
      }).addTo(g);
      mk.on("dragend", () => {
        const p = mk.getLatLng();
        setCorners((cs) => cs.map((x, j) => (j === i ? [p.lat, p.lng] : x)));
      });
    });
  }, [drawing, corners, closed, skinTick]);

  const saveBorder = (id: string, cs: LatLon[]) => {
    if (saving) return;
    setSaving(true);
    api
      .saveBorder(id, cs)
      .then(() => {
        toast(t.border_saved, { id: "border" });
        s.setBorderDraw(null);
        return s.announceChanged([id]);
      })
      .catch((e) => toast.error(String(e)))
      .finally(() => setSaving(false));
  };
  const save = useRef(saveBorder);
  save.current = saveBorder;

  // Click to place a corner, double-click to close (and save) the Border.
  useEffect(() => {
    const m = map.current;
    const el = host.current;
    if (!m || !el || !drawing) return;
    m.doubleClickZoom.disable();
    el.classList.add("map-drawing");
    const onClick = (e: L.LeafletMouseEvent) => {
      if (closed) return;
      setCorners((cs) => addCorner(cs, [e.latlng.lat, e.latlng.lng]));
    };
    const onDouble = (e: L.LeafletMouseEvent) => {
      if (closed) return;
      const at: LatLon = [e.latlng.lat, e.latlng.lng];
      setCorners((cs) => addCorner(cs, at));
      // Outside the updater, which React may run twice: one save per close.
      const done = addCorner(cornersRef.current, at);
      if (canClose(done)) {
        setClosed(true);
        save.current(drawing, done);
      }
    };
    m.on("click", onClick);
    m.on("dblclick", onDouble);
    return () => {
      m.off("click", onClick);
      m.off("dblclick", onDouble);
      m.doubleClickZoom.enable();
      el.classList.remove("map-drawing");
    };
  }, [drawing, closed]);
  const cornersRef = useRef(corners);
  cornersRef.current = corners;

  const confirmDelete = useDeleteBorder();
  const deleteBorder = (id: string) => confirmDelete(id, borderOf.get(id)?.path ?? "");
  const drawnBorder = drawing ? borderOf.get(drawing) : undefined;
  const inPieces = !!drawnBorder && !editableCorners(drawnBorder) && corners.length === 0;

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
      <PeriodBar undated={inPeriod.undated}>
        {extent && <PeriodSlider extent={extent} />}
      </PeriodBar>
      <div className="relative min-h-0 flex-1">
        <div data-testid="map" ref={host} className="size-full" />
        {draw && (
          <div
            data-testid="border-toolbar"
            className="absolute inset-x-2 top-2 z-[1000] mx-auto flex min-w-0 max-w-xl flex-wrap items-center gap-2 rounded-md border bg-popover p-2 text-popover-foreground shadow-md"
          >
            {regions.length === 0 && !drawing ? (
              <p className="min-w-0 flex-1 text-xs text-muted-foreground">{t.border_no_regions}</p>
            ) : (
              <>
                <label className="flex min-w-0 items-center gap-2 text-xs">
                  <span className="shrink-0 text-muted-foreground">{t.border_pick}</span>
                  <select
                    data-testid="border-region"
                    className="min-w-0 max-w-[12rem] truncate rounded border bg-background px-1 py-0.5 text-xs"
                    value={drawing ?? ""}
                    onChange={(e) => s.setBorderDraw({ placeId: e.currentTarget.value || null })}
                  >
                    <option value="">{t.border_pick_none}</option>
                    {/* A Place picked from its own page stays offered, region or not. */}
                    {drawing && !regions.some((r) => r.id === drawing) && (
                      <option value={drawing}>{s.docsById.get(drawing)?.title ?? drawing}</option>
                    )}
                    {regions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title}
                      </option>
                    ))}
                  </select>
                </label>
                {drawing && (
                  <p data-testid="border-hint" className="min-w-0 flex-1 basis-48 text-xs text-muted-foreground">
                    {inPieces ? t.border_pieces : t.border_hint}
                  </p>
                )}
              </>
            )}
            <div className="ml-auto flex min-w-0 flex-wrap items-center gap-1">
              {drawing && corners.length > 0 && !closed && (
                <Button size="sm" variant="ghost" className="h-auto min-h-8" data-testid="border-undo" onClick={() => setCorners((cs) => cs.slice(0, -1))}>
                  <Undo2 />
                  {t.border_undo}
                </Button>
              )}
              {drawing && drawnBorder && (
                <Button size="sm" variant="ghost" className="h-auto min-h-8" data-testid="border-delete" onClick={() => deleteBorder(drawing)}>
                  <Trash2 />
                  {t.border_delete}
                </Button>
              )}
              {drawing && (
                <Button
                  size="sm"
                  className="h-auto min-h-8"
                  data-testid="border-save"
                  disabled={!canClose(corners) || saving}
                  onClick={() => saveBorder(drawing, corners)}
                >
                  {t.border_save}
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-auto min-h-8" data-testid="border-cancel" onClick={() => s.setBorderDraw(null)}>
                <X />
                {t.cancel}
              </Button>
            </div>
          </div>
        )}
        {pinCard &&
          periodOn.current &&
          shown.some((p) => p.id === pinCard.id) &&
          (() => {
            const place = s.docsById.get(pinCard.id);
            const here = inPeriod.charactersAt.get(pinCard.id) ?? [];
            return (
              <div
                data-testid="map-pin-card"
                data-id={pinCard.id}
                className="absolute z-[1000] flex w-64 min-w-0 max-w-[calc(100%-1rem)] flex-col gap-1.5 rounded-md border bg-popover p-2 text-xs text-popover-foreground shadow-md"
                style={{ left: pinCard.left, top: pinCard.top, bottom: pinCard.bottom }}
              >
                <div className="flex min-w-0 items-start gap-1">
                  <button
                    type="button"
                    data-testid="map-pin-card-open"
                    className="min-w-0 flex-1 text-left text-sm font-semibold hover:underline"
                    onClick={() => {
                      setPinCard(null);
                      s.openDoc(pinCard.id);
                    }}
                  >
                    {place?.title ?? pinCard.id}
                  </button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t.close}
                    data-testid="map-pin-card-close"
                    onClick={() => setPinCard(null)}
                  >
                    <X />
                  </Button>
                </div>
                <p className="min-w-0 font-medium text-muted-foreground">{t.map_characters_here}</p>
                {here.length === 0 ? (
                  <p data-testid="map-pin-card-none" className="min-w-0 text-muted-foreground">
                    {t.map_characters_none}
                  </p>
                ) : (
                  <ul className="thin-scroll flex max-h-48 min-w-0 flex-col overflow-auto">
                    {here.map((c) => (
                      <li key={c.id} className="min-w-0">
                        <button
                          type="button"
                          data-testid="map-pin-card-character"
                          data-id={c.id}
                          className="w-full min-w-0 truncate rounded px-1 py-0.5 text-left hover:bg-accent"
                          onClick={() => {
                            setPinCard(null);
                            s.openDoc(c.id);
                          }}
                        >
                          {c.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })()}
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
            fillable={fillableData?.length ?? 0}
            onFill={() => fillKinds().catch(console.error)}
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
                onClick={() => {
                  s.setMapFilters({
                    ...mf,
                    tags: [],
                    books: [],
                    search: "",
                    mentionedOnly: false,
                  });
                  s.setPeriodFilter(NO_PERIOD_FILTER);
                }}
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
