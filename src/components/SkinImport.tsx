// Bringing a Skin into the Vault from outside it (PLAN §24.8), shared by Import
// and the Skin gallery (§26.3): a Skin already here by id asks "Replace or
// keep both" (keep both gets a new id); a name already taken becomes "Name 2".
// Either way the Skin brought in becomes the one the Vault wears.

import { useState, type ReactNode } from "react";
import { useAppearance } from "@/lib/appearance";
import { freeName, isBuiltin, normalizeSkin, type Skin } from "@/lib/skin";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function useSkinImport(): { bring: (skin: Skin) => Promise<void>; dialog: ReactNode } {
  const a = useAppearance();
  const t = useT();
  const ta = t.appearance;
  const skinName = (s: Skin) => ta.builtin_names[s.id] ?? s.name;
  const [same, setSame] = useState<Skin | null>(null);

  const finish = async (skin: Skin, replace: boolean) => {
    setSame(null);
    const others = a.skins.filter((s) => !(replace && s.id === skin.id)).map(skinName);
    const id = replace ? skin.id : isBuiltin(skin.id) || a.skins.some((s) => s.id === skin.id) ? "" : skin.id;
    const saved = await a.save({ ...skin, id, name: freeName(skin.name, others) });
    await a.select(saved.id);
  };

  const bring = async (raw: Skin) => {
    const skin = normalizeSkin(raw);
    if (skin.id && !isBuiltin(skin.id) && a.skins.some((s) => s.id === skin.id)) return setSame(skin);
    await finish(skin, false);
  };

  const dialog = (
    <AlertDialog open={!!same} onOpenChange={(o) => !o && setSame(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{same && ta.import_same_title(same.name)}</AlertDialogTitle>
          <AlertDialogDescription>{ta.import_same_body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
          <Button variant="outline" data-testid="skin-import-keep-both" onClick={() => same && finish(same, false).catch(console.error)}>
            {ta.import_keep_both}
          </Button>
          <AlertDialogAction data-testid="skin-import-replace" onClick={() => same && finish(same, true).catch(console.error)}>
            {ta.import_replace}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return { bring, dialog };
}
