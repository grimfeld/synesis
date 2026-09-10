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

  useEffect(() => {
    api.places().then(setPlaces).catch(console.error);
  }, [s.changeTick, s.docs]);

  useEffect(() => {
    if (!host.current || map.current) return;
    map.current = L.map(host.current, { center: [31.8, 35.2], zoom: 6, zoomControl: true });
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
      mk.on("click", () => s.openDoc(p.id));
      pts.push([p.lat, p.lon]);
    }
    if (pts.length) m.fitBounds(L.latLngBounds(pts).pad(0.3), { maxZoom: 9 });
  }, [places, s]);

  return (
    <div className="flex h-full flex-col">
      <ViewHeader title={t.views.map} icon={<MapPin />}>
        <span className="hidden truncate text-xs text-muted-foreground md:inline">{places.length === 0 ? t.no_places : t.map_hint}</span>
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => s.setDialog({ kind: "new", type: "place" })}>
          <Plus />
          {t.types.place}
        </Button>
      </ViewHeader>
      <div ref={host} className="min-h-0 flex-1" />
    </div>
  );
}
