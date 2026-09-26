// The Skin gallery (PLAN §26): community Skins from the repo's `skins/` folder,
// fetched when the gallery opens and never in the background. Tapping a row
// tries the Skin on over the whole app, so the gallery is a panel beside the
// view rather than a modal over it; Install keeps it, closing goes back.
//
// Docked on the right on a desktop, left of the Tutorial panel so the Skins
// Tutorial can stay open beside it; a bottom sheet on a phone.

import { useCallback, useEffect, useState } from "react";
import { Check, LayoutGrid, RotateCcw, X } from "lucide-react";
import { cn } from "cn";
import { api } from "@/lib/api";
import { useAppearance } from "@/lib/appearance";
import { readIndex, type GalleryEntry, type GallerySwatch } from "@/lib/skinGallery";
import type { Side, Skin } from "@/lib/skin";
import { useStore } from "@/lib/store";
import { useIsMobile } from "@/hooks/use-mobile";
import { useT } from "@/i18n";
import { useSkinImport } from "@/components/SkinImport";
import { IconButton } from "@/components/IconButton";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type Listing = { state: "loading" } | { state: "failed" } | { state: "ready"; skins: GalleryEntry[] };

export function SkinGallery() {
  const a = useAppearance();
  const s = useStore();
  if (!a.galleryOpen || s.view.kind !== "settings") return <Closer />;
  return <Gallery />;
}

/** Leaving Settings closes the gallery (and so ends any try-on). */
function Closer() {
  const a = useAppearance();
  useEffect(() => {
    if (a.galleryOpen) a.setGalleryOpen(false);
  }, [a.galleryOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function Gallery() {
  const a = useAppearance();
  const t = useT();
  const ta = t.appearance;
  const mobile = useIsMobile();
  const skinImport = useSkinImport();
  const [listing, setListing] = useState<Listing>({ state: "loading" });
  const [fetched, setFetched] = useState<Record<string, Skin>>({});
  const [side, setSide] = useState<Side>(a.side);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setListing({ state: "loading" });
    api
      .skinGallery()
      .then((v) => setListing({ state: "ready", skins: readIndex(v) }))
      .catch((e) => {
        console.warn("Skin gallery:", e);
        setListing({ state: "failed" });
      });
  }, []);
  useEffect(load, [load]);

  // The side on screen follows the toggle while the gallery is open; closing
  // it gives back the Device's mode and the Vault's Skin.
  useEffect(() => {
    a.preview(side);
  }, [side]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      a.trial(null);
      a.preview(null);
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const close = () => a.setGalleryOpen(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape in a dialog above the gallery is the dialog's.
      if (e.key === "Escape" && !document.querySelector("[role=alertdialog]")) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const installed = (e: GalleryEntry) => a.skins.find((s) => s.id === e.id) ?? null;
  const fetchSkin = async (e: GalleryEntry): Promise<Skin> => {
    const have = fetched[e.file];
    if (have) return have;
    const skin = await api.gallerySkin(e.file);
    setFetched((f) => ({ ...f, [e.file]: skin }));
    return skin;
  };

  const tryOn = async (e: GalleryEntry) => {
    setError(null);
    const mine = installed(e);
    if (mine && mine.id === a.active.id) return a.trial(null);
    try {
      a.trial(mine ?? (await fetchSkin(e)));
    } catch (err) {
      setError(ta.gallery_install_failed(String(err)));
    }
  };
  const install = async (e: GalleryEntry) => {
    setError(null);
    try {
      await skinImport.bring(await fetchSkin(e));
    } catch (err) {
      setError(ta.gallery_install_failed(String(err)));
    }
  };
  const wear = (e: GalleryEntry) => {
    const mine = installed(e);
    if (mine) a.select(mine.id).catch(console.error);
  };

  const header = (
    <header className="flex min-h-12 shrink-0 items-center gap-2 border-b px-3">
      <LayoutGrid className="size-4 shrink-0 text-muted-foreground" />
      <h2 className="min-w-0 flex-1 text-sm font-semibold">{ta.gallery_title}</h2>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={side}
        onValueChange={(v) => v && setSide(v as Side)}
        data-testid="skin-gallery-side"
      >
        {(["light", "dark"] as const).map((m) => (
          <ToggleGroupItem key={m} value={m} className="min-h-8 h-auto" data-testid={`skin-gallery-side-${m}`}>
            {ta.modes[m]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <IconButton label={ta.gallery_close} onClick={close} data-testid="skin-gallery-close">
        <X />
      </IconButton>
    </header>
  );

  const body = (
    <div className="min-h-0 flex-1 overflow-y-auto p-3" data-testid="skin-gallery-body" data-state={listing.state}>
      <p className="mb-3 text-sm text-muted-foreground">{ta.gallery_hint}</p>
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
      {listing.state === "loading" && (
        <div className="grid gap-2" aria-label={ta.gallery_loading}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}
      {listing.state === "failed" && (
        <div className="grid justify-items-start gap-2" data-testid="skin-gallery-failed">
          <p className="text-sm">{ta.gallery_failed}</p>
          <Button variant="outline" size="sm" className="min-h-8 h-auto" onClick={load} data-testid="skin-gallery-retry">
            <RotateCcw /> {ta.gallery_retry}
          </Button>
        </div>
      )}
      {listing.state === "ready" && !listing.skins.length && <p className="text-sm">{ta.gallery_empty}</p>}
      {listing.state === "ready" && (
        <ul className="grid gap-2">
          {listing.skins.map((e) => {
            const mine = installed(e);
            const wearing = !!mine && mine.id === a.active.id;
            const trying = a.trying?.id === e.id;
            return (
              <li
                key={e.id}
                data-testid="skin-gallery-item"
                data-id={e.id}
                data-trying={trying}
                data-installed={!!mine}
                className={cn("grid min-w-0 gap-2 rounded-lg border bg-card p-2", (trying || (wearing && !a.trying)) && "ring-2 ring-ring")}
              >
                <button
                  type="button"
                  onClick={() => tryOn(e).catch(console.error)}
                  data-testid="skin-gallery-try"
                  className="flex min-w-0 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Swatches light={e.light} dark={e.dark} />
                  <span className="grid min-w-0 flex-1">
                    <span className="min-w-0 break-words text-sm font-medium">{e.name}</span>
                    {e.author && <span className="min-w-0 break-words text-xs text-muted-foreground">{ta.gallery_by(e.author)}</span>}
                    {trying && <span className="text-xs text-muted-foreground">{ta.gallery_trying}</span>}
                  </span>
                </button>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  {!mine && (
                    <Button size="sm" className="min-h-8 h-auto" onClick={() => install(e)} data-testid="skin-gallery-install">
                      {ta.gallery_install}
                    </Button>
                  )}
                  {mine && (
                    <>
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Check className="size-3.5" /> {ta.gallery_installed}
                      </span>
                      <Button size="sm" className="min-h-8 h-auto" disabled={wearing} onClick={() => wear(e)} data-testid="skin-gallery-wear">
                        {wearing ? ta.gallery_wearing : ta.gallery_wear}
                      </Button>
                      <Button variant="outline" size="sm" className="min-h-8 h-auto" onClick={() => install(e)} data-testid="skin-gallery-reinstall">
                        {ta.gallery_reinstall}
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {skinImport.dialog}
    </div>
  );

  if (mobile)
    return (
      <aside
        data-testid="skin-gallery"
        data-layout="sheet"
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[62vh] min-w-0 flex-col rounded-t-xl border-t bg-background pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(0,0,0,0.12)]"
      >
        {header}
        {body}
      </aside>
    );
  return (
    <aside data-testid="skin-gallery" data-layout="docked" className="flex h-full w-80 min-w-0 shrink-0 flex-col border-l bg-background">
      {header}
      {body}
    </aside>
  );
}

/** A Skin's two sides as page-coloured chips with a line of ink and a dot of accent. */
function Swatches({ light, dark }: { light: GallerySwatch; dark: GallerySwatch }) {
  const chip = (c: GallerySwatch, side: Side) => (
    <span
      data-testid={`skin-gallery-swatch-${side}`}
      className="flex h-10 w-8 flex-col justify-center gap-1 rounded border px-1.5"
      style={{ background: c.background }}
    >
      <span className="h-0.5 w-full rounded" style={{ background: c.text }} />
      <span className="h-0.5 w-3/4 rounded" style={{ background: c.text }} />
      <span className="size-2 rounded-full" style={{ background: c.accent }} />
    </span>
  );
  return (
    <span className="flex shrink-0 gap-1" aria-hidden>
      {chip(light, "light")}
      {chip(dark, "dark")}
    </span>
  );
}
