// "Fill in kinds from the gazetteer" (PLAN §27.13): offer to set `kind` on the
// Places that have none and whose title the bundled gazetteer knows. Never
// silent — the confirmation names every Place it would touch — and it only
// ever adds a missing Property, so it rewrites nothing the user wrote.
import { useCallback } from "react";
import { toast } from "sonner";
import { api } from "./api";
import { useStore } from "./store";
import { useT } from "@/i18n";

export function useFillKinds(): () => Promise<void> {
  const s = useStore();
  const t = useT();
  const { setDialog, announceChanged } = s;
  return useCallback(async () => {
    const found = await api.kindSuggestions();
    if (found.length === 0) {
      toast(t.fill_kinds_none, { id: "fill-kinds" });
      return;
    }
    setDialog({
      kind: "confirm",
      title: t.fill_kinds_title,
      body: t.fill_kinds_body(found.length),
      items: found.map((f) => `${f.title} — ${t.place_kind[f.kind] ?? f.kind}`),
      confirmLabel: t.fill_kinds_confirm(found.length),
      onConfirm: () => {
        api
          .fillKinds(found)
          .then((r) => {
            toast(t.fill_kinds_done(r.filled.length), { id: "fill-kinds" });
            return announceChanged(r.filled);
          })
          .catch(console.error);
      },
    });
  }, [setDialog, announceChanged, t]);
}
