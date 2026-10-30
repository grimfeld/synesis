// The Map's Border drawing mode (ADR 0023): the toolbar, the outline drawn so
// far with a handle on each corner, and the clicks that place corners. The
// corner list itself is edited by the pure helpers in lib/border; the engine
// writes the `.geojson` file. Kept out of MapView, which only draws.
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import L from "leaflet";
import { Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { api, type Border, type LatLon } from "@/lib/api";
import { addCorner, canClose, editableCorners } from "@/lib/border";
import { useDeleteBorder } from "@/lib/useBorders";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function BorderDrawing({
  map,
  host,
  ready,
  borders,
  regions,
  skinTick,
}: {
  map: RefObject<L.Map | null>;
  host: RefObject<HTMLDivElement | null>;
  /** Whether the Map exists yet: it is made after this mounts. */
  ready: boolean;
  borders: Border[];
  /** Every region Place, the only Places that take a Border, by title. */
  regions: { id: string; title: string }[];
  /** Bumped when the Skin changes, so the outline takes its new colour. */
  skinTick: number;
}) {
  const s = useStore();
  const t = useT();
  const draw = s.borderDraw;
  const drawing = draw?.placeId ?? null;
  const borderOf = useMemo(() => new Map(borders.map((b) => [b.doc, b])), [borders]);
  const [corners, setCorners] = useState<LatLon[]>([]);
  const [closed, setClosed] = useState(false);
  const [saving, setSaving] = useState(false);
  const cornersRef = useRef(corners);
  cornersRef.current = corners;

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

  // The Border being drawn: its outline so far and a handle on each corner,
  // above the pins.
  const draftLayer = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const g = L.layerGroup().addTo(m);
    draftLayer.current = g;
    return () => {
      g.remove();
      draftLayer.current = null;
    };
  }, [ready, map]);
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
  }, [ready, drawing, corners, closed, skinTick]);

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
    if (!ready || !m || !el || !drawing) return;
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
  }, [ready, map, host, drawing, closed]);

  const confirmDelete = useDeleteBorder();
  const drawnBorder = drawing ? borderOf.get(drawing) : undefined;
  const inPieces = !!drawnBorder && !editableCorners(drawnBorder) && corners.length === 0;

  if (!draw) return null;
  return (
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
          <Button
            size="sm"
            variant="ghost"
            className="h-auto min-h-8"
            data-testid="border-delete"
            onClick={() => confirmDelete(drawing, drawnBorder.path)}
          >
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
  );
}
