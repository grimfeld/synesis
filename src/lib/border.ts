// Drawing a region's Border on the Map (ADR 0023). The engine writes the
// `.geojson` file; this is the corner list the drawing mode edits on the way,
// kept pure so it is tested once (`test:unit`) and the view stays a Leaflet
// shell — the `map.ts` precedent.
import type { Border, LatLon } from "./api";
import { kindCatalogue, kindOf } from "./map";

/** The built-in kinds alone: a custom kind can never shadow `region`. */
const BUILTIN = kindCatalogue([]);

/**
 * Whether a document is a region Place: the kind that can have a Border. Its
 * `kind` is read as the Map reads it (`kindOf`), ignoring case and accents.
 */
export function isRegion(doc: { type: string; kind?: unknown }): boolean {
  return (
    doc.type === "place" &&
    typeof doc.kind === "string" &&
    kindOf(doc.kind, BUILTIN)?.name === "region"
  );
}

const same = (a: LatLon, b: LatLon) => a[0] === b[0] && a[1] === b[1];

/**
 * The corners of a Border as the drawing mode edits them: the outer ring,
 * without the repeat that closes it.
 *
 * `null` for a Border the drawing mode cannot edit without losing part of it:
 * one in several pieces or with a hole (imported, most likely), or one that
 * could not be read. Such a Border can still be redrawn or deleted.
 */
export function editableCorners(border: Border): LatLon[] | null {
  if (border.status !== "ok" || border.polygons.length !== 1) return null;
  const rings = border.polygons[0];
  if (rings.length !== 1) return null;
  const ring = rings[0];
  const open =
    ring.length > 1 && same(ring[0], ring[ring.length - 1])
      ? ring.slice(0, -1)
      : ring.slice();
  return open.map(([a, b]) => [a, b] as LatLon);
}

/**
 * Add a corner where the reader clicked. A click on the corner just placed is
 * ignored: a double-click, which closes the Border, arrives as two clicks
 * first, and those must not add a corner on top of the last.
 */
export function addCorner(corners: LatLon[], at: LatLon): LatLon[] {
  const last = corners[corners.length - 1];
  if (last && same(last, at)) return corners;
  return [...corners, at];
}

/** Whether these corners enclose an area: at least three different ones. */
export function canClose(corners: LatLon[]): boolean {
  const distinct = new Set(corners.map(([a, b]) => `${a},${b}`));
  return distinct.size >= 3;
}

/**
 * Tell every view that reads Borders to read them again: a Border file can
 * change without its Place changing (a peer delivered it, ADR 0023).
 */
export const BORDERS_CHANGED = "borders:changed";
