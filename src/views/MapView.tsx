import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { MapPin, Plus } from "lucide-react";
import { api, type DocSummary } from "@/lib/api";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";
import { ViewHeader } from "@/components/ViewHeader";
import { Button } from "@/components/ui/button";

export function MapView() {
  const s = useStore();
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const [places, setPlaces] = useState<DocSummary[]>([]);
  // Opening a Place must not re-run the marker effect: the store object changes
  // on every update, and a re-run would refit the view under the reader.
  const openDoc = useRef(s.openDoc);
  openDoc.current = s.openDoc;
  // Fit once per set of Places; after that the view is the reader's to keep.
  const fitted = useRef("");

  useEffect(() => {
    api.places().then(setPlaces).catch(console.error);
  }, [s.changeTick, s.docs]);

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
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const color = getComputedStyle(document.documentElement).getPropertyValue("--c-place").trim() || "#c04f6b";
    const pts: L.LatLngTuple[] = [];
    for (const p of places) {
      if (p.lat == null || p.lon == null) continue;
      const mk = L.circleMarker([p.lat, p.lon], { radius: 7, color, fillColor: color, fillOpacity: 0.85, weight: 1.5 }).addTo(g);
      mk.bindTooltip(p.title, { permanent: true, direction: "right", offset: [8, 0], className: "map-label" });
      mk.on("click", () => openDoc.current(p.id));
      pts.push([p.lat, p.lon]);
    }
    const key = pts.map(([a, b]) => `${a},${b}`).join(";");
    if (pts.length && fitted.current !== key) {
      fitted.current = key;
      m.fitBounds(L.latLngBounds(pts).pad(0.3), { maxZoom: 9 });
    }
  }, [places]);

  return (
    <div className="flex h-full flex-col">
      <ViewHeader title={t.views.map} icon={<MapPin />}>
        <span className="hidden truncate text-xs text-muted-foreground md:inline">{places.length === 0 ? t.no_places : t.map_hint}</span>
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => s.setDialog({ kind: "new", type: "place" })}>
          <Plus />
          {t.types.place}
        </Button>
      </ViewHeader>
      <div data-testid="map" ref={host} className="min-h-0 flex-1" />
    </div>
  );
}
