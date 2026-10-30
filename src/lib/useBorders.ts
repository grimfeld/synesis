// Every region Border, kept fresh (ADR 0023).
//
// A Border is asked again when a Place changes (writing one rewrites the
// Place's `border`), and when a Border file arrives on its own from a paired
// Device (`BORDERS_CHANGED`), which changes no document at all.
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n";
import { api, type Border, type PlaceFact } from "./api";
import { BORDERS_CHANGED, isRegion } from "./border";
import { useQuery } from "./useQuery";
import { useStore } from "./store";

export function useBorders(): Border[] {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick((n) => n + 1);
    window.addEventListener(BORDERS_CHANGED, on);
    return () => window.removeEventListener(BORDERS_CHANGED, on);
  }, []);
  const { data } = useQuery<Border[]>({
    key: [tick],
    deps: { types: ["place"] },
    fetch: () => api.borders(),
  });
  return data ?? [];
}

/**
 * The ids of every region Place: the only Places a Border is offered for
 * (ADR 0023). A Place's kind lives in its frontmatter, which a document
 * summary does not carry, so it is read from the Map's facts.
 */
export function useRegionIds(): Set<string> {
  const { data } = useQuery<PlaceFact[]>({
    key: [],
    deps: { types: ["place"] },
    fetch: () => api.placeFacts(),
  });
  return useMemo(
    () => new Set((data ?? []).filter((f) => isRegion({ type: "place", kind: f.kind })).map((f) => f.doc)),
    [data],
  );
}

/**
 * Start drawing a Border: go to the Map in its drawing mode, with that region
 * picked, or with none so the Map asks which.
 */
export function useDrawBorder(): (regionId: string | null) => void {
  const { setBorderDraw, navigate } = useStore();
  return useCallback(
    (regionId: string | null) => {
      setBorderDraw({ placeId: regionId });
      navigate({ kind: "map" });
    },
    [setBorderDraw, navigate],
  );
}

/**
 * Import a region's Border from a `.geojson` file: the system's picker, then
 * the engine copies the file beside the Place (every piece kept) and sets
 * `border`. The page only reads the picked file's text, as Insert Picture
 * does; the engine refuses one with no area in it, and says why.
 */
export function useImportBorder(): (id: string) => void {
  const s = useStore();
  const t = useT();
  const { announceChanged } = s;
  return useCallback(
    (id: string) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".geojson,.json,application/geo+json,application/json";
      input.style.display = "none";
      input.dataset.testid = "border-input";
      input.onchange = () => {
        const file = input.files?.[0];
        input.remove();
        if (!file) return;
        file
          .text()
          .then((text) => api.importBorder(id, file.name, text))
          .then(() => {
            toast(t.border_imported, { id: "border" });
            return announceChanged([id]);
          })
          .catch((e) => toast.error(t.border_import_failed(String(e)), { id: "border" }));
      };
      // Closing the picker without a choice: the input goes too.
      input.oncancel = () => input.remove();
      document.body.appendChild(input);
      input.click();
    },
    [announceChanged, t],
  );
}

/**
 * Delete a region's Border, behind a confirm naming its file: the file goes,
 * and the region is shown by its name alone again.
 */
export function useDeleteBorder(): (id: string, path: string) => void {
  const s = useStore();
  const t = useT();
  const { setDialog, setBorderDraw, announceChanged } = s;
  return useCallback(
    (id: string, path: string) =>
      setDialog({
        kind: "confirm",
        title: t.border_delete_title,
        body: t.border_delete_body,
        items: [path],
        confirmLabel: t.border_delete,
        onConfirm: () => {
          api
            .deleteBorder(id)
            .then(() => {
              toast(t.border_deleted, { id: "border" });
              setBorderDraw(null);
              return announceChanged([id]);
            })
            .catch((e) => toast.error(String(e)));
        },
      }),
    [setDialog, setBorderDraw, announceChanged, t],
  );
}
