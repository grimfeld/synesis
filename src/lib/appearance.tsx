// Appearance (PLAN §24): which Skin the app wears and which side of it shows,
// applied as inline CSS variables on <html> over the built-in palette in
// index.css. Skins and the Vault's choice come from the engine (ADR 0017);
// the Appearance mode and Text scale are this Device's settings.
//
// The last resolved look is cached in localStorage and painted before React
// starts, so there is no flash of the default Skin while the Vault opens, and
// the Welcome screen (no Vault yet) wears the last one too.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import {
  ALL_VARS,
  BUILTIN_SKINS,
  DEFAULT_SKIN_ID,
  isBuiltin,
  normalizeSkin,
  pickSkin,
  resolveSide,
  sideFor,
  typographyVars,
  type AppearanceMode,
  type Palette,
  type Side,
  type Skin,
} from "./skin";
import { useStore } from "./store";

const CACHE_KEY = "synesis.appearance";
const TYPO_VARS = Object.keys(typographyVars({}));
const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

interface Cached {
  skin: Skin;
  mode: AppearanceMode;
  scale: number;
}

function readCache(): Cached | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Cached) : null;
  } catch {
    return null;
  }
}

function writeCache(c: Cached) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch {
    // Private window or blocked storage: the next start paints the default first.
  }
}

let lastApplied: { key: string; palette: Palette } | null = null;

/**
 * Paint `skin`'s `side` onto the document. Returns the resolved palette.
 * Painting the same look again does nothing, and in particular does not fire
 * `skin:applied`: views that redraw on it (the Map) must not redraw mid-gesture
 * because a Skin object was re-read unchanged.
 */
export function applySkin(skin: Skin, side: Side, scale: number): Palette {
  const key = JSON.stringify([skin.id, skin[side], side, scale]);
  if (lastApplied?.key === key) return lastApplied.palette;
  const root = document.documentElement;
  root.classList.toggle("dark", side === "dark");
  for (const v of [...ALL_VARS, ...TYPO_VARS]) root.style.removeProperty(v);
  // The base palette for this side, as index.css defines it.
  const cs = getComputedStyle(root);
  const base: Palette = {};
  for (const v of ALL_VARS) base[v] = cs.getPropertyValue(v).trim();
  const s = normalizeSkin(skin)[side];
  const changed = resolveSide(base, s);
  for (const [k, v] of Object.entries({ ...changed, ...typographyVars(s.typography) })) root.style.setProperty(k, v);
  root.style.fontSize = scale === 1 ? "" : `${scale * 100}%`;
  root.dataset.skin = skin.id;
  // Mobile status and navigation bars follow the page.
  const bg = changed["--background"] ?? base["--background"];
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = bg;
  const palette = { ...base, ...changed };
  lastApplied = { key, palette };
  window.dispatchEvent(new CustomEvent("skin:applied"));
  return palette;
}

/** Before React: paint the cached look, and keep following the OS until the provider takes over. */
export function initAppearance() {
  const c = readCache();
  const paint = () => {
    const now = readCache() ?? c;
    applySkin(now?.skin ?? BUILTIN_SKINS[0], sideFor(now?.mode ?? "system", darkQuery().matches), now?.scale ?? 1);
  };
  paint();
  darkQuery().addEventListener("change", () => {
    if (!providerMounted) paint();
  });
}

let providerMounted = false;

export interface AppearanceApi {
  mode: AppearanceMode;
  scale: number;
  /** The side on screen right now. */
  side: Side;
  /** Built-ins first, then the Vault's own. */
  skins: Skin[];
  active: Skin;
  /** The resolved palette on screen, for contrast badges. */
  palette: Palette;
  setMode: (m: AppearanceMode) => void;
  setScale: (n: number) => void;
  select: (id: string) => Promise<void>;
  /** Save a Vault Skin now (the editor debounces its own calls). Returns the saved Skin. */
  save: (skin: Skin) => Promise<Skin>;
  remove: (id: string) => Promise<void>;
  /** Show this side while the Skin editor is open, whatever the mode says; null to stop. */
  preview: (side: Side | null) => void;
  /** Paint a Skin being edited before it is saved. null to go back to the saved one. */
  draft: (skin: Skin | null) => void;
  /**
   * Wear any Skin over the whole app without saving or caching it, whatever
   * its id: the Skin gallery's try-on (PLAN §26.7). `active` stays the saved
   * Skin. null to stop.
   */
  trial: (skin: Skin | null) => void;
  /** The Skin being tried on, if any. */
  trying: Skin | null;
  /** Whether the Skin gallery is open. It lives beside the view, not in it. */
  galleryOpen: boolean;
  setGalleryOpen: (open: boolean) => void;
  reload: () => Promise<void>;
}

const Ctx = createContext<AppearanceApi | null>(null);

export function useAppearance(): AppearanceApi {
  const a = useContext(Ctx);
  if (!a) throw new Error("appearance missing");
  return a;
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const s = useStore();
  const root = s.info?.root ?? null;
  const cached = useMemo(readCache, []);
  const [vaultSkins, setVaultSkins] = useState<Skin[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [mode, setModeState] = useState<AppearanceMode>(cached?.mode ?? "system");
  const [scale, setScaleState] = useState(cached?.scale ?? 1);
  const [systemDark, setSystemDark] = useState(() => darkQuery().matches);
  const [previewSide, setPreviewSide] = useState<Side | null>(null);
  const [draftSkin, setDraftSkin] = useState<Skin | null>(null);
  const [trialSkin, setTrialSkin] = useState<Skin | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [palette, setPalette] = useState<Palette>({});

  useEffect(() => {
    providerMounted = true;
    const mq = darkQuery();
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener("change", on);
    return () => {
      providerMounted = false;
      mq.removeEventListener("change", on);
    };
  }, []);

  // The Device's own settings, once the store has them.
  const settings = s.settings;
  useEffect(() => {
    if (!settings) return;
    setModeState(settings.appearance_mode ?? "system");
    setScaleState(settings.text_scale > 0 ? settings.text_scale : 1);
  }, [settings]);

  const reload = useCallback(async () => {
    if (!root) {
      setVaultSkins([]);
      setActiveId(null);
      setLoaded(false);
      return;
    }
    const [list, ap] = await Promise.all([api.skins(), api.appearance()]);
    setVaultSkins(list.map(normalizeSkin));
    setActiveId(ap.skin);
    setLoaded(true);
  }, [root]);

  useEffect(() => {
    reload().catch(console.error);
  }, [reload]);

  // Another Device changed a Skin or the Vault's choice (ADR 0016).
  useEffect(() => {
    let un: (() => void) | undefined;
    api
      .onConfigChanged((names) => {
        if (names.some((n) => n === "appearance.json" || n.startsWith("skins/"))) reload().catch(console.error);
      })
      .then((u) => (un = u))
      .catch(() => {});
    return () => un?.();
  }, [reload]);

  const skins = useMemo(() => [...BUILTIN_SKINS, ...vaultSkins], [vaultSkins]);
  // No Vault open (or not read yet): keep wearing the cached look.
  const saved = loaded ? pickSkin(activeId, vaultSkins) : (cached?.skin ?? BUILTIN_SKINS[0]);
  const active = draftSkin && draftSkin.id === saved.id ? draftSkin : saved;
  const side = previewSide ?? sideFor(mode, systemDark);

  useEffect(() => {
    setPalette(applySkin(trialSkin ?? active, side, scale));
    if (!draftSkin) writeCache({ skin: active, mode, scale });
  }, [active, side, scale, mode, draftSkin, trialSkin]);

  const setMode = useCallback(
    (m: AppearanceMode) => {
      setModeState(m);
      api.setDeviceAppearance(m, scale).catch(console.error);
    },
    [scale],
  );
  const setScale = useCallback(
    (n: number) => {
      setScaleState(n);
      api.setDeviceAppearance(mode, n).catch(console.error);
    },
    [mode],
  );
  const select = useCallback(async (id: string) => {
    setDraftSkin(null);
    setTrialSkin(null);
    setActiveId(id);
    await api.setAppearance({ skin: id === DEFAULT_SKIN_ID ? null : id });
  }, []);
  const save = useCallback(async (skin: Skin) => {
    if (isBuiltin(skin.id)) throw new Error("built-in Skins cannot be saved");
    const out = normalizeSkin(await api.saveSkin(skin));
    setVaultSkins((list) => {
      const rest = list.filter((x) => x.id !== out.id);
      return [...rest, out].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    });
    return out;
  }, []);
  const remove = useCallback(
    async (id: string) => {
      await api.deleteSkin(id);
      setVaultSkins((list) => list.filter((x) => x.id !== id));
      if (activeId === id) await select(DEFAULT_SKIN_ID);
    },
    [activeId, select],
  );

  const value = useMemo<AppearanceApi>(
    () => ({
      mode,
      scale,
      side,
      skins,
      active,
      palette,
      setMode,
      setScale,
      select,
      save,
      remove,
      preview: setPreviewSide,
      draft: setDraftSkin,
      trial: setTrialSkin,
      trying: trialSkin,
      galleryOpen,
      setGalleryOpen,
      reload,
    }),
    [mode, scale, side, skins, active, palette, setMode, setScale, select, save, remove, reload, trialSkin, galleryOpen],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
