import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { api, type DocSummary } from "@/lib/api";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";

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
    const pts: L.LatLngTuple[] = [];
    for (const p of places) {
      if (p.lat == null || p.lon == null) continue;
      const mk = L.circleMarker([p.lat, p.lon], { radius: 7, color: "#c04f6b", fillColor: "#c04f6b", fillOpacity: 0.85, weight: 1.5 }).addTo(g);
      mk.bindTooltip(p.title, { permanent: true, direction: "right", offset: [8, 0], className: "map-label" });
      mk.on("click", () => s.openDoc(p.id));
      pts.push([p.lat, p.lon]);
    }
    if (pts.length) m.fitBounds(L.latLngBounds(pts).pad(0.3), { maxZoom: 9 });
  }, [places, s]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: "var(--border)" }}>
        {!s.sidebarOpen && (
          <button className="btn btn-ghost btn-sm" onClick={() => s.setSidebarOpen(true)}>
            ☰
          </button>
        )}
        <h1 className="text-base font-semibold">{t.views.map}</h1>
        <span className="muted text-xs">{places.length === 0 ? t.no_places : t.map_hint}</span>
        <button className="btn btn-sm ml-auto" onClick={() => s.setDialog({ kind: "new", type: "place" })}>
          + {t.types.place}
        </button>
      </header>
      <div ref={host} className="min-h-0 flex-1" />
    </div>
  );
}
