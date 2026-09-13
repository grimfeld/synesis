// Exporting a Board as a picture (PLAN §16.18).
//
// The Board is already SVG, so an export is that SVG with the viewport reset
// to the content's extent and the theme's colours resolved to literals — a
// `var(--foreground)` means nothing once the file leaves the app. PNG is the
// same SVG rasterised through a canvas.
import { contentBounds } from "./board";
import type { Board } from "./api";

/** Margin around the content in the exported picture, in Board pixels. */
const MARGIN = 40;

/**
 * Freeze the live SVG into a standalone document.
 *
 * The node is cloned rather than mutated: the Board on screen must not flicker
 * because someone exported it.
 */
export function boardToSvg(source: SVGSVGElement, board: Board): string {
  const b = contentBounds(board.nodes);
  const width = (b?.width ?? 400) + MARGIN * 2;
  const height = (b?.height ?? 300) + MARGIN * 2;
  const minX = (b?.x ?? 0) - MARGIN;
  const minY = (b?.y ?? 0) - MARGIN;

  const svg = source.cloneNode(true) as SVGSVGElement;
  // Drop the pan/zoom transform: the export frames the content, not whatever
  // happened to be on screen.
  const root = svg.querySelector("g");
  root?.removeAttribute("transform");
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("xmlns:xhtml", "http://www.w3.org/1999/xhtml");
  svg.setAttribute("viewBox", `${minX} ${minY} ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.removeAttribute("class");

  inlineStyles(source, svg);
  stripInteractive(svg);

  const bg = getComputedStyle(source).getPropertyValue("background-color");
  const rect =
    `<rect x="${minX}" y="${minY}" width="${width}" height="${height}" ` +
    `fill="${bg && bg !== "rgba(0, 0, 0, 0)" ? bg : "#ffffff"}"/>`;
  const inner = svg.innerHTML;
  const attrs = Array.from(svg.attributes)
    .map((a) => `${a.name}="${escapeAttr(a.value)}"`)
    .join(" ");
  return `<svg ${attrs}>${rect}${inner}</svg>`;
}

/**
 * Copy computed colours onto the clone.
 *
 * Tailwind classes and CSS variables do not survive the file leaving the page,
 * so every fill, stroke and text colour is resolved to a literal here. Walking
 * both trees in step relies on the clone having the same shape as the source,
 * which it does because it was cloned whole.
 */
function inlineStyles(source: Element, clone: Element) {
  const cs = getComputedStyle(source);
  const el = clone as HTMLElement & { style: CSSStyleDeclaration };
  const isText = source.tagName === "text" || source.tagName === "tspan";
  if (source instanceof SVGElement) {
    const fill = cs.fill;
    const stroke = cs.stroke;
    if (fill && fill !== "none") el.style.fill = fill;
    if (stroke && stroke !== "none") el.style.stroke = stroke;
    if (cs.strokeWidth) el.style.strokeWidth = cs.strokeWidth;
    if (isText) {
      el.style.fontSize = cs.fontSize;
      el.style.fontFamily = cs.fontFamily;
      el.style.fontWeight = cs.fontWeight;
    }
  } else {
    // HTML inside foreignObject: the node cards.
    el.style.color = cs.color;
    el.style.background = cs.backgroundColor;
    el.style.font = cs.font;
    el.style.border = cs.border;
    el.style.borderRadius = cs.borderRadius;
    el.style.padding = cs.padding;
    el.style.display = cs.display;
    el.style.flexDirection = cs.flexDirection;
    el.style.gap = cs.gap;
    el.style.overflow = "hidden";
    el.style.width = cs.width;
    el.style.height = cs.height;
    el.removeAttribute("class");
  }
  const sk = source.children;
  const ck = clone.children;
  for (let i = 0; i < sk.length && i < ck.length; i++) {
    inlineStyles(sk[i], ck[i]);
  }
}

/** Remove the handles and overlays that only make sense while editing. */
function stripInteractive(svg: SVGSVGElement) {
  svg.querySelectorAll("[data-board-ui]").forEach((el) => {
    // Edge labels are content; the toolbar and handles are not.
    if (el.tagName === "foreignObject" && el.querySelector("span")) return;
    el.remove();
  });
  svg.querySelectorAll("button").forEach((el) => el.remove());
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** Rasterise an SVG string to base64 PNG at `scale` times its natural size. */
export async function svgToPng(svg: string, scale = 2): Promise<string> {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("could not render the Board"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png").split(",")[1] ?? "";
  } finally {
    URL.revokeObjectURL(url);
  }
}
