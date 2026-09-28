// The Map's base layer (ADR 0018, PLAN §27.9): a bundled atlas of the Bible's
// world instead of a street map. Land, lakes and rivers are Natural Earth
// shapes filled with Skin colours; relief is a grey hillshade blended over the
// land; past zoom 7, where the bundle runs out of detail, a muted online layer
// takes over when there is a network. Built by `scripts/atlas.mjs`.
//
// Leaflet-specific, so not in `map.ts`: nothing here is worth a unit test that
// a screenshot would not catch better.
import L from "leaflet";

/** Where the bundled atlas is served from, beside the app. */
const BASE = `${import.meta.env.BASE_URL ?? "/"}atlas/`;

interface AtlasData {
  bbox: { west: number; east: number; south: number; north: number };
  minZoom: number;
  maxZoom: number;
  land: [number, number][][];
  lakes: [number, number][][];
  rivers: { rank: number; line: [number, number][] }[];
}

let data: Promise<AtlasData | null> | null = null;

/** The atlas shapes, fetched once per session; null if the bundle is missing. */
function load(): Promise<AtlasData | null> {
  data ??= fetch(`${BASE}atlas.json`)
    .then((r) => (r.ok ? (r.json() as Promise<AtlasData>) : null))
    .catch(() => null);
  return data;
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Leaflet wants [lat, lon]; the atlas stores [lon, lat] like GeoJSON. */
const ll = (pts: [number, number][]): L.LatLngTuple[] => pts.map(([lon, lat]) => [lat, lon]);

/** The zoom past which the online layer draws over the atlas. */
export const ONLINE_FROM = 8;

export interface Atlas {
  /** Re-read the Skin's atlas colours, after a Skin or theme change. */
  restyle: () => void;
}

/**
 * Put the atlas under `map`. `online` adds the close-up online layer; the
 * mini-maps leave it out, since they never zoom in that far.
 */
export function addAtlas(map: L.Map, { online = true }: { online?: boolean } = {}): Atlas {
  const container = map.getContainer();
  container.classList.add("atlas");
  // Panes below Leaflet's own tile pane (200): land, then relief blended onto
  // it, then water drawn over both so lakes and rivers stay crisp.
  const pane = (name: string, z: number) => {
    const p = map.getPane(name) ?? map.createPane(name);
    p.style.zIndex = String(z);
    p.style.pointerEvents = "none";
    return name;
  };
  const landPane = pane("atlas-land", 150);
  const reliefPane = pane("atlas-relief", 160);
  const waterPane = pane("atlas-water", 170);
  map.getPane(reliefPane)!.classList.add("atlas-relief");

  const landRenderer = L.canvas({ pane: landPane, padding: 0.5 });
  const waterRenderer = L.canvas({ pane: waterPane, padding: 0.5 });
  const shapes: { layer: L.Path; style: () => L.PathOptions }[] = [];

  L.tileLayer(`${BASE}relief/{z}/{x}/{y}.png`, {
    pane: reliefPane,
    minNativeZoom: 3,
    maxNativeZoom: 7,
    minZoom: 0,
    maxZoom: 19,
    bounds: L.latLngBounds([
      [10, 5],
      [48, 62],
    ]),
    attribution: "Relief: Mapzen Terrain Tiles (SRTM, GMTED2010, ETOPO1) · Natural Earth",
  }).addTo(map);

  if (online)
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      minZoom: ONLINE_FROM,
      maxZoom: 19,
      className: "atlas-online",
      attribution: "© OpenStreetMap",
    }).addTo(map);

  const restyle = () => {
    for (const s of shapes) s.layer.setStyle(s.style());
  };

  load().then((a) => {
    // The map may have been removed while the shapes were loading.
    if (!a || !(map as unknown as { _loaded?: boolean })._loaded) return;
    const land = () => ({
      fillColor: cssVar("--c-atlas-land", "#efe8d8"),
      fillOpacity: 1,
      color: cssVar("--c-atlas-coast", "#9fb4bb"),
      weight: 0.8,
      opacity: 1,
    });
    const lake = () => ({
      fillColor: cssVar("--c-atlas-water", "#c6d8df"),
      fillOpacity: 1,
      color: cssVar("--c-atlas-coast", "#9fb4bb"),
      weight: 0.6,
      opacity: 1,
    });
    // The sea as a shape, not just the container's background: the relief
    // blends only with what is drawn inside Leaflet's map pane, and over an
    // empty sea its neutral grey would show as grey.
    const sea = () => ({ fillColor: cssVar("--c-atlas-water", "#c9dbe1"), fillOpacity: 1, stroke: false });
    const seaLayer = L.rectangle(
      [
        [-85, -180],
        [85, 180],
      ],
      { ...sea(), renderer: landRenderer, interactive: false },
    ).addTo(map);
    shapes.push({ layer: seaLayer, style: sea });
    for (const ring of a.land) {
      const layer = L.polygon(ll(ring), { ...land(), renderer: landRenderer, interactive: false, smoothFactor: 1.5 }).addTo(map);
      shapes.push({ layer, style: land });
    }
    for (const ring of a.lakes) {
      const layer = L.polygon(ll(ring), { ...lake(), renderer: waterRenderer, interactive: false }).addTo(map);
      shapes.push({ layer, style: lake });
    }
    for (const r of a.rivers) {
      // Natural Earth ranks rivers 0 (the Nile) upwards; bigger draws wider.
      const style = () => ({
        color: cssVar("--c-atlas-river", "#7fa3b3"),
        weight: Math.max(0.6, 2 - r.rank * 0.2),
        opacity: 0.9,
      });
      const layer = L.polyline(ll(r.line), { ...style(), renderer: waterRenderer, interactive: false, smoothFactor: 1.5 }).addTo(map);
      shapes.push({ layer, style });
    }
  });

  return { restyle };
}
