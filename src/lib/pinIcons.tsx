// The curated icons a Place kind's pin may wear (PLAN §27.4): the built-in
// kinds' five, and the set a custom kind picks from. One family, one line
// weight, tintable — the reason custom kinds cannot bring emoji or SVG.
//
// Leaflet draws markers from HTML strings, so each icon is also rendered once
// to static SVG markup and cached.
import { renderToStaticMarkup } from "react-dom/server";
import {
  Anchor,
  Bird,
  BookOpen,
  Building,
  Castle,
  Church,
  Circle,
  Columns3,
  Cross,
  Crown,
  DoorOpen,
  Droplet,
  Fence,
  Fish,
  Flag,
  Flame,
  Flower,
  Footprints,
  Gem,
  Grape,
  House,
  Landmark,
  Leaf,
  Map as MapIcon,
  Milestone,
  Mountain,
  MountainSnow,
  Pickaxe,
  Pyramid,
  Sailboat,
  Scroll,
  Shell,
  Shield,
  Ship,
  Signpost,
  Skull,
  Sprout,
  Star,
  Store,
  Sun,
  Swords,
  Tent,
  TowerControl,
  TreePalm,
  TreePine,
  Trees,
  Warehouse,
  Waves,
  Wheat,
  Wine,
  type LucideIcon,
} from "lucide-react";

/** Every icon a pin may wear, by the name a kind stores. Never rename one: Vaults store the name. */
export const PIN_ICONS: Record<string, LucideIcon> = {
  castle: Castle,
  mountain: Mountain,
  waves: Waves,
  map: MapIcon,
  landmark: Landmark,
  tent: Tent,
  house: House,
  building: Building,
  church: Church,
  columns: Columns3,
  pyramid: Pyramid,
  tower: TowerControl,
  store: Store,
  warehouse: Warehouse,
  "door-open": DoorOpen,
  fence: Fence,
  crown: Crown,
  cross: Cross,
  flame: Flame,
  star: Star,
  scroll: Scroll,
  "book-open": BookOpen,
  swords: Swords,
  shield: Shield,
  flag: Flag,
  skull: Skull,
  gem: Gem,
  pickaxe: Pickaxe,
  "mountain-snow": MountainSnow,
  trees: Trees,
  "tree-pine": TreePine,
  "tree-palm": TreePalm,
  sprout: Sprout,
  leaf: Leaf,
  flower: Flower,
  wheat: Wheat,
  grape: Grape,
  wine: Wine,
  droplet: Droplet,
  fish: Fish,
  shell: Shell,
  anchor: Anchor,
  ship: Ship,
  sailboat: Sailboat,
  bird: Bird,
  sun: Sun,
  milestone: Milestone,
  signpost: Signpost,
  footprints: Footprints,
};

/** The icons offered when making a custom kind, in picker order. */
export const PIN_ICON_NAMES = Object.keys(PIN_ICONS);

/** An icon by stored name; the plain dot for a name this version does not know. */
export function pinIcon(name: string | null | undefined): LucideIcon {
  return (name && PIN_ICONS[name]) || Circle;
}

const svgCache = new Map<string, string>();

/** An icon as SVG markup, for Leaflet's HTML markers. White on the coloured disc. */
export function pinIconSvg(name: string | null | undefined, size: number): string {
  const key = `${name ?? ""}|${size}`;
  let svg = svgCache.get(key);
  if (!svg) {
    const Icon = pinIcon(name);
    svg = renderToStaticMarkup(<Icon size={size} strokeWidth={2.25} aria-hidden="true" />);
    svgCache.set(key, svg);
  }
  return svg;
}
