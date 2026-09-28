#!/usr/bin/env node
// Builds the Map's bundled atlas (ADR 0018, PLAN §27.9) into public/atlas/:
//
//   atlas.json            land, lakes and rivers of the Bible's world, as
//                         simplified [lon, lat] rings and lines (Natural Earth,
//                         public domain). The app fills them with Skin colours.
//   relief/{z}/{x}/{y}.png
//                         hillshade, zooms 3 to 7, as grey where 128 is flat:
//                         darker is shadow, lighter is light. The app blends it
//                         over the land (soft-light), so it works on any Skin.
//                         Computed from Mapzen's Terrain Tiles (AWS Open Data:
//                         SRTM, GMTED2010, ETOPO1) and masked to land, so the
//                         sea floor and the Jordan valley's below-sea-level
//                         land are told apart by the coastline, not by height.
//
//   node scripts/atlas.mjs          download (cached in target/atlas-cache) and build
//
// Needs network on first run only; everything is cached. Output is committed,
// so neither the app build nor CI ever runs this.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "public", "atlas");
const cache = path.join(root, "target", "atlas-cache");

/** The Bible's world: Rome to Persia, the Black Sea to Sheba. */
export const BBOX = { west: 5, east: 62, south: 10, north: 48 };
export const MIN_ZOOM = 3;
export const MAX_ZOOM = 7;
const TILE = 256;
const TERRAIN = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
const NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";

// ------------------------------------------------------------------ fetching

async function cached(url, file) {
  const p = path.join(cache, file);
  if (fs.existsSync(p)) return fs.readFileSync(p);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(p, buf);
      return buf;
    } catch (e) {
      if (attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

async function pool(items, n, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: n }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

// ---------------------------------------------------------------- projection

const lon2x = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};
const y2lat = (y, z) => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
};

function tileRange(z) {
  return {
    x0: Math.floor(lon2x(BBOX.west, z)),
    x1: Math.floor(lon2x(BBOX.east, z)),
    y0: Math.floor(lat2y(BBOX.north, z)),
    y1: Math.floor(lat2y(BBOX.south, z)),
  };
}

// ------------------------------------------------------------------ vectors

/** Clip a ring to the bbox (Sutherland–Hodgman), so a continent-sized ring stays small. */
function clipRing(ring, b) {
  const edges = [
    (p) => p[0] >= b.west, (p) => p[0] <= b.east, (p) => p[1] >= b.south, (p) => p[1] <= b.north,
  ];
  const cut = [
    (a, c) => [b.west, a[1] + ((c[1] - a[1]) * (b.west - a[0])) / (c[0] - a[0])],
    (a, c) => [b.east, a[1] + ((c[1] - a[1]) * (b.east - a[0])) / (c[0] - a[0])],
    (a, c) => [a[0] + ((c[0] - a[0]) * (b.south - a[1])) / (c[1] - a[1]), b.south],
    (a, c) => [a[0] + ((c[0] - a[0]) * (b.north - a[1])) / (c[1] - a[1]), b.north],
  ];
  let pts = ring;
  for (let e = 0; e < 4; e++) {
    const inside = edges[e];
    const next = [];
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i];
      const prev = pts[(i + pts.length - 1) % pts.length];
      if (inside(cur)) {
        if (!inside(prev)) next.push(cut[e](prev, cur));
        next.push(cur);
      } else if (inside(prev)) next.push(cut[e](prev, cur));
    }
    pts = next;
    if (!pts.length) break;
  }
  return pts;
}

/** Douglas–Peucker, in degrees. */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    let far = -1;
    let best = tol;
    for (let i = a + 1; i < b; i++) {
      // A closed ring starts and ends on one point: measure from that point.
      const d =
        len < 1e-12
          ? Math.hypot(pts[i][0] - ax, pts[i][1] - ay)
          : Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
      if (d > best) {
        best = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * Simplify finely inside the Bible's world and coarsely outside it, where the
 * land is only there so no view ends in a straight edge. The ring is cut into
 * runs of points inside and outside, each simplified on its own.
 */
function simplifyIn(ring, tol) {
  const inside = (p) => p[0] >= BBOX.west - 3 && p[0] <= BBOX.east + 3 && p[1] >= BBOX.south - 3 && p[1] <= BBOX.north + 3;
  const out = [];
  let run = [ring[0]];
  for (let i = 1; i < ring.length; i++) {
    if (inside(ring[i]) !== inside(run[run.length - 1]) || i === ring.length - 1) {
      run.push(ring[i]);
      const s = simplify(run, inside(run[0]) ? tol : tol * 8);
      out.push(...(out.length ? s.slice(1) : s));
      run = [ring[i]];
    } else run.push(ring[i]);
  }
  return out;
}

const round = (p) => [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4];

function inBox(pts) {
  return pts.some((p) => p[0] >= BBOX.west && p[0] <= BBOX.east && p[1] >= BBOX.south && p[1] <= BBOX.north);
}

function rings(geom) {
  if (geom.type === "Polygon") return geom.coordinates;
  if (geom.type === "MultiPolygon") return geom.coordinates.flat();
  return [];
}

function lines(geom) {
  if (geom.type === "LineString") return [geom.coordinates];
  if (geom.type === "MultiLineString") return geom.coordinates;
  return [];
}

async function vectors() {
  const read = async (name) => JSON.parse((await cached(`${NE}/${name}.geojson`, `${name}.geojson`)).toString("utf8"));
  // Land runs well past the Bible's world, so no view ends in a straight
  // coastline; lakes only matter inside it.
  const wide = { west: -30, east: 110, south: -40, north: 72 };
  const pad = { west: BBOX.west - 2, east: BBOX.east + 2, south: BBOX.south - 2, north: BBOX.north + 2 };
  const polys = (fc, box, tol, minArea = 0) =>
    fc.features
      .flatMap((f) => rings(f.geometry))
      .map((r) => clipRing(r, box))
      .filter((r) => r.length >= 4)
      .map((r) => simplifyIn(r, tol).map(round))
      .filter((r) => r.length >= 4 && Math.abs(area(r)) >= minArea);
  const land = polys(await read("ne_10m_land"), wide, 0.01, 0.0004);
  // Minor islands are a separate Natural Earth layer; Cyprus and Crete are in land.
  const lakes = polys(await read("ne_10m_lakes"), pad, 0.005, 0.0004);
  // Rivers worth drawing at this scale: Natural Earth ranks them 0 (biggest) up.
  const riverFc = await read("ne_10m_rivers_lake_centerlines");
  const rivers = riverFc.features
    .filter((f) => (f.properties.scalerank ?? 10) <= 7)
    .flatMap((f) => lines(f.geometry).map((l) => ({ l, rank: f.properties.scalerank ?? 7 })))
    .filter(({ l }) => inBox(l))
    .map(({ l, rank }) => ({ rank, line: simplify(l, 0.005).map(round) }))
    .filter(({ line }) => line.length >= 2);
  return { land, lakes, rivers };
}

function area(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return a / 2;
}

// ------------------------------------------------------------------ relief

async function terrain(z) {
  const { x0, x1, y0, y1 } = tileRange(z);
  // One tile of margin all round, so slopes at the edge have neighbours.
  const tx0 = x0 - 1, ty0 = y0 - 1, tw = x1 - x0 + 3, th = y1 - y0 + 3;
  const W = tw * TILE, H = th * TILE;
  const elev = new Float32Array(W * H);
  const jobs = [];
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) jobs.push([tx, ty]);
  await pool(jobs, 8, async ([tx, ty]) => {
    const x = tx0 + tx, y = ty0 + ty;
    const png = PNG.sync.read(await cached(`${TERRAIN}/${z}/${x}/${y}.png`, `terrarium/${z}/${x}/${y}.png`));
    for (let py = 0; py < TILE; py++)
      for (let px = 0; px < TILE; px++) {
        const i = (py * TILE + px) * 4;
        const d = png.data;
        elev[(ty * TILE + py) * W + tx * TILE + px] = d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768;
      }
  });
  return { elev, W, H, tx0, ty0, tw, th };
}

/** Even-odd scanline fill of rings (in lon/lat) into a mosaic mask. */
function fill(mask, W, H, z, tx0, ty0, ringsLL, value) {
  const edges = [];
  for (const r of ringsLL) {
    const pts = r.map(([lon, lat]) => [(lon2x(lon, z) - tx0) * TILE, (lat2y(lat, z) - ty0) * TILE]);
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [ax, ay] = pts[j];
      const [bx, by] = pts[i];
      if (ay === by) continue;
      edges.push(ay < by ? [ax, ay, bx, by] : [bx, by, ax, ay]);
    }
  }
  const byRow = new Map();
  for (const e of edges) {
    const r0 = Math.max(0, Math.ceil(e[1] - 0.5));
    const r1 = Math.min(H - 1, Math.floor(e[3] - 0.5));
    for (let r = r0; r <= r1; r++) {
      let list = byRow.get(r);
      if (!list) byRow.set(r, (list = []));
      list.push(e);
    }
  }
  for (const [row, list] of byRow) {
    const y = row + 0.5;
    const xs = list.map(([ax, ay, bx, by]) => ax + ((y - ay) * (bx - ax)) / (by - ay)).sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] - 0.5));
      const to = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = from; x <= to; x++) mask[row * W + x] ^= value;
    }
  }
}

/**
 * Horn's hillshade, light from the north-west at 45°, as a grey where the
 * shade of flat ground is 128: only relief moves it. Low zooms exaggerate
 * more, or mountains a few pixels across would not show at all.
 */
function hillshade({ elev, W, H, tx0, ty0 }, z, land) {
  const out = new Uint8Array(W * H).fill(128);
  const exaggerate = { 3: 14, 4: 10, 5: 7, 6: 5.5, 7: 4.5, 8: 3.5 }[z] ?? 3;
  const az = (315 * Math.PI) / 180;
  const alt = (45 * Math.PI) / 180;
  const flat = Math.sin(alt);
  for (let y = 1; y < H - 1; y++) {
    const lat = y2lat(ty0 + (y + 0.5) / TILE, z);
    const m = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (TILE * 2 ** z);
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (!land[i]) continue;
      const e = (dx, dy) => elev[i + dy * W + dx];
      const gx = ((e(1, -1) + 2 * e(1, 0) + e(1, 1)) - (e(-1, -1) + 2 * e(-1, 0) + e(-1, 1))) / (8 * m);
      const gy = ((e(-1, 1) + 2 * e(0, 1) + e(1, 1)) - (e(-1, -1) + 2 * e(0, -1) + e(1, -1))) / (8 * m);
      const slope = Math.atan(exaggerate * Math.hypot(gx, gy));
      const aspect = Math.atan2(gy, -gx);
      const shade =
        Math.sin(alt) * Math.cos(slope) + Math.cos(alt) * Math.sin(slope) * Math.cos(az - Math.PI / 2 - aspect);
      // Quantised to steps of 4: invisible after blending, and a third the bytes.
      const v = 128 + (shade - flat) * 230;
      out[i] = Math.max(0, Math.min(255, Math.round(v / 4) * 4));
    }
  }
  return out;
}

async function relief(z, vec) {
  const t = await terrain(z);
  const land = new Uint8Array(t.W * t.H);
  fill(land, t.W, t.H, z, t.tx0, t.ty0, vec.land, 1);
  // Lakes are water however high they lie: the Sea of Galilee, the Dead Sea.
  fill(land, t.W, t.H, z, t.tx0, t.ty0, vec.lakes, 1);
  const shade = hillshade(t, z, land);
  const { x0, x1, y0, y1 } = tileRange(z);
  let bytes = 0;
  let files = 0;
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++) {
      const png = new PNG({ width: TILE, height: TILE, colorType: 0, inputColorType: 0, bitDepth: 8, inputHasAlpha: false });
      const ox = (x - t.tx0) * TILE;
      const oy = (y - t.ty0) * TILE;
      const data = Buffer.alloc(TILE * TILE);
      for (let py = 0; py < TILE; py++)
        for (let px = 0; px < TILE; px++) data[py * TILE + px] = shade[(oy + py) * t.W + ox + px];
      png.data = data;
      const buf = PNG.sync.write(png, { colorType: 0, inputColorType: 0, inputHasAlpha: false, deflateLevel: 9, filterType: -1 });
      const p = path.join(out, "relief", String(z), String(x), `${y}.png`);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, buf);
      bytes += buf.length;
      files++;
    }
  return { files, bytes };
}

// ------------------------------------------------------------------ main

const vec = await vectors();
fs.mkdirSync(out, { recursive: true });
const atlas = {
  bbox: BBOX,
  minZoom: MIN_ZOOM,
  maxZoom: MAX_ZOOM,
  land: vec.land,
  lakes: vec.lakes,
  rivers: vec.rivers,
};
fs.writeFileSync(path.join(out, "atlas.json"), JSON.stringify(atlas));
console.log(`atlas.json: ${vec.land.length} land rings, ${vec.lakes.length} lakes, ${vec.rivers.length} rivers, ${(fs.statSync(path.join(out, "atlas.json")).size / 1024).toFixed(0)} KB`);
fs.rmSync(path.join(out, "relief"), { recursive: true, force: true });
let total = 0;
for (let z = MIN_ZOOM; z <= MAX_ZOOM; z++) {
  const { files, bytes } = await relief(z, vec);
  total += bytes;
  console.log(`relief z${z}: ${files} tiles, ${(bytes / 1024 / 1024).toFixed(2)} MB`);
}
console.log(`relief total: ${(total / 1024 / 1024).toFixed(2)} MB`);
