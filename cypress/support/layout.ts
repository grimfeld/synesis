/// <reference types="cypress" />

// Layout checks shared by the specs that walk the app at phone width.
//
// Two ways a view can be too wide for its screen:
// - clipped: a child laid out wider than an `overflow-hidden` ancestor (a Card),
//   so its end is cut off;
// - scrolled: a pane meant to scroll vertically (`overflow-auto`) holds content
//   wider than itself, so on a phone the whole view slides sideways.
// A box that means to scroll sideways says so with `overflow-x-auto` (the
// Library shelf) or is a `pre`; everything else must fit its width.

/** Skip what is not laid out in the page's flow, or is meant to overhang. */
const ignored = (el: HTMLElement) => {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return true;
  if (el.classList.contains("sr-only")) return true;
  // Leaflet paints tiles, markers and labels outside the pane on purpose.
  if (el.closest(".leaflet-container")) return true;
  // A Board is a pannable canvas: its nodes and edges are meant to extend
  // past the frame, and what is off-screen is reached by panning, not by
  // making the window wider. Its toolbar sits outside the SVG and is still
  // checked.
  if (el.closest("[data-testid=board-canvas]")) return true;
  // Sheets and popovers that are closing are still in the DOM, parked off-screen.
  return !!el.closest("[data-state=closed],[aria-hidden=true],[hidden]");
};

const describeEl = (el: Element) =>
  `${el.tagName.toLowerCase()}${el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : ""}.${el.className.toString().slice(0, 50)} — "${(el.textContent ?? "").trim().slice(0, 40)}"`;

/** Elements laid out wider than the nearest ancestor that clips them. */
export const clipped = (win: Window) => {
  const bad: string[] = [];
  // A fixed or absolutely positioned box is not laid out inside the scroller
  // above it, so the search for a clipping ancestor stops there.
  const clipper = (el: HTMLElement) => {
    if (win.getComputedStyle(el).position === "fixed") return null;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const s = win.getComputedStyle(p);
      if (s.position === "fixed" || s.position === "absolute") return null;
      if (s.overflowX !== "visible") return p;
    }
    return win.document.documentElement;
  };
  for (const el of Array.from(win.document.querySelectorAll<HTMLElement>("body *"))) {
    if (ignored(el)) continue;
    const box = clipper(el);
    if (!box) continue;
    // A scroller may hold content wider than itself; `scrolledSideways` judges it.
    const o = win.getComputedStyle(box).overflowX;
    if (o !== "hidden" && o !== "clip") continue;
    const r = el.getBoundingClientRect();
    const pr = box.getBoundingClientRect();
    if (r.right > pr.right + 1 || r.left < pr.left - 1) bad.push(describeEl(el));
  }
  return bad;
};

/** Scrollers that scroll sideways without saying they mean to. */
export const scrolledSideways = (win: Window) => {
  const bad: string[] = [];
  const doc = win.document.documentElement;
  if (doc.scrollWidth > doc.clientWidth + 1) bad.push(`the page itself (${doc.scrollWidth}px in ${doc.clientWidth}px)`);
  for (const el of Array.from(win.document.querySelectorAll<HTMLElement>("body *"))) {
    const o = win.getComputedStyle(el).overflowX;
    if (o !== "auto" && o !== "scroll") continue;
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    if (ignored(el)) continue;
    if (el.tagName === "PRE" || /\boverflow-x-(auto|scroll)\b/.test(el.className.toString())) continue;
    bad.push(`${describeEl(el)} (${el.scrollWidth}px in ${el.clientWidth}px)`);
  }
  return bad;
};

/** Fail on anything clipped or scrolling sideways in the current view. */
export const expectNoOverflow = () =>
  cy.window().then((win) => {
    expect(clipped(win).join("\n"), "elements wider than their container").to.equal("");
    expect(scrolledSideways(win).join("\n"), "panes that scroll sideways").to.equal("");
  });
