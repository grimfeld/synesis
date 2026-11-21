// Pan and zoom for a drawing in a box: wheel and drag on a desktop, pinch
// and drag on touch. The same gestures as the Graph view's canvas
// (`src/views/GraphView.tsx`), copied rather than extracted, since there they
// are tangled with dragging a node. Used by the Family tree.
import { useCallback, useRef, useState, type PointerEvent, type WheelEvent } from "react";

/** Screen = world × k + (x, y). */
export interface Viewport {
  x: number;
  y: number;
  k: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The view panned the least that shows `b` (world units) in a `w` × `h` box
 * with `pad` of room, at the same zoom; `v` itself when `b` is already in view.
 * Too large to fit, its top-left corner shows.
 */
export function revealed(v: Viewport, b: Bounds, w: number, h: number, pad = 16): Viewport {
  const shift = (lo: number, hi: number, size: number) =>
    hi - lo > size - pad * 2 || lo < pad ? pad - lo : hi > size - pad ? size - pad - hi : 0;
  const dx = shift(b.x * v.k + v.x, (b.x + b.width) * v.k + v.x, w);
  const dy = shift(b.y * v.k + v.y, (b.y + b.height) * v.k + v.y, h);
  return dx || dy ? { ...v, x: v.x + dx, y: v.y + dy } : v;
}

/** A drag shorter than this is a click. */
const CLICK_SLOP = 4;

/** Capturing a pointer the browser does not know about throws; the drag works without it. */
function capture(el: Element, id: number) {
  try {
    el.setPointerCapture(id);
  } catch {
    /* synthetic pointer, or already released */
  }
}

export function usePanZoom({ min = 0.05, max = 3 }: { min?: number; max?: number } = {}) {
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, k: 1 });
  const live = useRef(view);
  live.current = view;
  const box = useRef<HTMLElement | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; k: number; wx: number; wy: number } | null>(null);
  const drag = useRef<{ x: number; y: number; lx: number; ly: number; panning: boolean } | null>(null);
  /** The gesture that just ended moved the view: the click it ends in is no click. */
  const dragged = useRef(false);

  const wasDragged = useCallback(() => dragged.current, []);
  const clamp = useCallback((k: number) => Math.max(min, Math.min(max, k)), [min, max]);

  /** Zoom by `f` around a point of the box (its middle by default). */
  const zoomBy = useCallback(
    (f: number, at?: { x: number; y: number }) => {
      const el = box.current;
      const mx = at?.x ?? (el ? el.clientWidth / 2 : 0);
      const my = at?.y ?? (el ? el.clientHeight / 2 : 0);
      setView((v) => {
        const k = clamp(v.k * f);
        return { k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k };
      });
    },
    [clamp],
  );

  /**
   * Frame `b` (world units) in the box, with some room, never larger than
   * life. With `minK`, never smaller than that either: what does not fit then
   * shows the top of `start` (by default `b`), centred. False when the box has
   * no size yet (a Pane not laid out).
   */
  const fit = useCallback(
    (b: Bounds, opts: { minK?: number; start?: Bounds } = {}): boolean => {
      const pad = 32;
      const el = box.current;
      if (!el || b.width <= 0) return false;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w === 0 || h === 0) return false;
      const k = clamp(Math.min(1, (w - pad * 2) / b.width, (h - pad * 2) / Math.max(1, b.height)));
      if (opts.minK !== undefined && k < opts.minK) {
        const s = opts.start ?? b;
        const k2 = clamp(opts.minK);
        setView({ k: k2, x: w / 2 - (s.x + s.width / 2) * k2, y: pad - s.y * k2 });
      } else setView({ k, x: w / 2 - (b.x + b.width / 2) * k, y: h / 2 - (b.y + b.height / 2) * k });
      return true;
    },
    [clamp],
  );

  /**
   * Pan the least that brings `b` (world units) into the box with some room,
   * at the same zoom: a person focused from the keyboard, off-screen.
   */
  const reveal = useCallback((b: Bounds) => {
    const el = box.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w === 0 || h === 0) return;
    setView((v) => revealed(v, b, w, h));
  }, []);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const pinchState = () => {
    const [a, b] = [...touches.current.values()];
    if (!a || !b || !box.current) return null;
    const m = local({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
    const v = live.current;
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), k: v.k, mx: m.x, my: m.y, wx: (m.x - v.x) / v.k, wy: (m.y - v.y) / v.k };
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragged.current = false;
    if (touches.current.size === 2) {
      drag.current = null;
      pinch.current = pinchState();
      dragged.current = true;
      if (box.current) for (const id of touches.current.keys()) capture(box.current, id);
      return;
    }
    pinch.current = null;
    drag.current = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, panning: false };
  };

  const onPointerMove = (e: PointerEvent) => {
    if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p0 = pinch.current;
    if (p0 && touches.current.size === 2) {
      const now = pinchState();
      if (!now || now.dist < 1 || p0.dist < 1) return;
      const k = clamp(p0.k * (now.dist / p0.dist));
      // Keep the world point that was under the fingers' midpoint under it.
      setView({ k, x: now.mx - p0.wx * k, y: now.my - p0.wy * k });
      return;
    }
    const d = drag.current;
    if (!d) return;
    if (!d.panning) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < CLICK_SLOP) return;
      // Only now: capturing at once would send the click to the box, not the person under it.
      d.panning = true;
      dragged.current = true;
      if (box.current) capture(box.current, e.pointerId);
    }
    const dx = e.clientX - d.lx;
    const dy = e.clientY - d.ly;
    d.lx = e.clientX;
    d.ly = e.clientY;
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };

  const onPointerUp = (e: PointerEvent) => {
    touches.current.delete(e.pointerId);
    if (touches.current.size < 2) pinch.current = null;
    if (touches.current.size === 0) drag.current = null;
  };

  const onWheel = (e: WheelEvent) => {
    if (!box.current) return;
    zoomBy(Math.exp(-e.deltaY * 0.0015), local(e));
  };

  return {
    view,
    box,
    zoomBy,
    fit,
    reveal,
    /** Whether the gesture that just ended panned or pinched, so a click it ends in is ignored. */
    dragged: wasDragged,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onWheel,
    },
  };
}
