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
  placeBooks,
  placeTags,
  routePoints,
  routeToken,
  type PlaceFacts,
  type RoutePoint,
} from "@/lib/map";
import { useQuery } from "@/lib/useQuery";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";
import { ViewHeader } from "@/components/ViewHeader";
import { MapFilters } from "@/components/MapFilters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Read a CSS custom property, so routes follow the theme like every colour. */
function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

export function MapView() {
  const s = useStore();
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
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
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap" }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    // Leaflet only measures its box on a window resize; the Tutorial panel
    // docking beside the Map, or the sidebar closing, changes it without one.
    const ro = new ResizeObserver(() => map.current?.invalidateSize());
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

    // Routes first, so markers sit on top of their own lines.
    for (const r of routes) {
      const color = cssVar(r.color, placeColor);
      for (let i = 0; i + 1 < r.points.length; i++) {
        const leg = bezierLeg(r.points[i].at, r.points[i + 1].at);
        L.polyline(leg, {
          color,
          weight: 2.5,
          opacity: 0.85,
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

    for (const p of shown) {
      if (p.lat == null || p.lon == null) continue;
      const color = routeColorOf.has(p.id)
        ? cssVar(routeColorOf.get(p.id)!, placeColor)
        : placeColor;
      const mk = L.circleMarker([p.lat, p.lon], { radius: 7, color, fillColor: color, fillOpacity: 0.85, weight: 1.5 }).addTo(g);
      // Numbered when a route passes through: the number is the Stop's position
      // in the whole route, and a Place visited twice carries both (§19.10).
      const ns = numbersOf.get(p.id);
      const label = ns ? `${ns.join(" · ")} ${p.title}` : p.title;
      mk.bindTooltip(label, { permanent: true, direction: "right", offset: [8, 0], className: "map-label" });
      mk.on("click", () => openDoc.current(p.id));
      pts.push([p.lat, p.lon]);
    }
    const key = pts.map(([a, b]) => `${a},${b}`).join(";");
    if (pts.length && fitted.current !== key) {
      fitted.current = key;
      m.fitBounds(L.latLngBounds(pts).pad(0.3), { maxZoom: 9 });
    }
  }, [shown, routes, routeColorOf, numbersOf, skinTick]);

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
            bookName={(n) =>
              s.books.find((b) => b.number === n)?.name ?? String(n)
            }
          />
          <Button size="sm" variant="outline" onClick={() => s.setDialog({ kind: "new", type: "place" })}>
            <Plus />
            {t.types.place}
          </Button>
        </div>
      </ViewHeader>
      <div className="relative min-h-0 flex-1">
        <div data-testid="map" ref={host} className="size-full" />
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
