// Touch input on a phone: the Timeline pans and pinches, the Graph pans, pinches
// and opens a node by tap, and the Map keeps the view the reader chose.
// Cypress only dispatches the events, so these drive pointer events directly.

type Pt = { id: number; x: number; y: number };

const pointer = (
  el: Element,
  type: string,
  { id, x, y }: Pt,
  extra: Record<string, unknown> = {},
) =>
  el.dispatchEvent(
    new PointerEvent(type, {
      pointerId: id,
      pointerType: "touch",
      isPrimary: id === 1,
      clientX: x,
      clientY: y,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      bubbles: true,
      cancelable: true,
      ...extra,
    }),
  );

/** One finger down, dragged to (x2,y2), up. */
function swipe(el: Element, x1: number, y1: number, x2: number, y2: number) {
  const steps = 8;
  pointer(el, "pointerdown", { id: 1, x: x1, y: y1 });
  for (let i = 1; i <= steps; i++)
    pointer(el, "pointermove", {
      id: 1,
      x: x1 + ((x2 - x1) * i) / steps,
      y: y1 + ((y2 - y1) * i) / steps,
    });
  pointer(el, "pointerup", { id: 1, x: x2, y: y2 });
}

/** Two fingers around (cx,cy) moving from `from` px apart to `to` px apart. */
function pinch(el: Element, cx: number, cy: number, from: number, to: number) {
  const steps = 8;
  const at = (d: number) => [cx - d / 2, cx + d / 2];
  const [l0, r0] = at(from);
  pointer(el, "pointerdown", { id: 1, x: l0, y: cy });
  pointer(el, "pointerdown", { id: 2, x: r0, y: cy });
  for (let i = 1; i <= steps; i++) {
    const [l, r] = at(from + ((to - from) * i) / steps);
    pointer(el, "pointermove", { id: 1, x: l, y: cy });
    pointer(el, "pointermove", { id: 2, x: r, y: cy });
  }
  const [l1, r1] = at(to);
  pointer(el, "pointerup", { id: 1, x: l1, y: cy });
  pointer(el, "pointerup", { id: 2, x: r1, y: cy });
}

const tap = (el: Element, x: number, y: number) => {
  pointer(el, "pointerdown", { id: 1, x, y });
  pointer(el, "pointerup", { id: 1, x, y });
};

const span = ($svg: JQuery<HTMLElement>) =>
  Number($svg.attr("data-to")) - Number($svg.attr("data-from"));
const from = ($svg: JQuery<HTMLElement>) => Number($svg.attr("data-from"));

describe("Touch", () => {
  beforeEach(() => {
    cy.viewport(390, 844);
    cy.openApp();
  });

  /** On a phone the views live behind the sidebar sheet. */
  const goTo = (view: string) => {
    cy.get("[data-sidebar=trigger]").first().click();
    cy.get(`[data-testid=nav-${view}]`).click();
    cy.get("[data-sidebar=sidebar][data-mobile=true]").should("not.exist");
  };

  it("pans and pinch-zooms the Timeline with one and two fingers", () => {
    goTo("timeline");
    cy.get("[data-testid=timeline] svg").then(($svg) => {
      const el = $svg[0];
      const start = { from: from($svg), span: span($svg) };
      // The browser must not claim the horizontal drag for its own scrolling.
      expect(getComputedStyle(el).touchAction).to.match(/pan-y/);

      swipe(el, 320, 300, 120, 300);
      cy.get("[data-testid=timeline] svg").should(($z) => {
        // A pan moves the window without resizing it.
        expect(span($z)).to.be.closeTo(start.span, start.span * 0.02);
        expect(from($z)).to.be.greaterThan(start.from);
      });

      cy.get("[data-testid=timeline] svg").then(($p) => {
        const before = span($p);
        pinch($p[0], 200, 400, 80, 300);
        cy.get("[data-testid=timeline] svg").should(($z) => {
          expect(span($z)).to.be.lessThan(before / 2);
        });
      });
    });
  });

  it("pans, pinch-zooms and opens a node in the Graph", () => {
    goTo("graph");
    cy.get("[data-testid=graph-canvas]").should("exist");
    // Nothing may hand the gesture to the browser.
    cy.get("[data-testid=graph-canvas]").should(
      "have.css",
      "touch-action",
      "none",
    );

    // The canvas has no DOM to assert on, so compare a digest of its pixels.
    // Drawing is coalesced onto an animation frame, so the digest has to retry.
    const digestNow = (c: HTMLCanvasElement) => {
      const px = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      let h = 0;
      for (let i = 0; i < px.length; i += 997) h = (h * 31 + px[i]) | 0;
      return h;
    };
    const repaints = (gesture: (c: HTMLCanvasElement) => void) =>
      cy.get("[data-testid=graph-canvas]").then(($c) => {
        const c = $c[0] as HTMLCanvasElement;
        const before = digestNow(c);
        gesture(c);
        cy.get("[data-testid=graph-canvas]").should(($a) =>
          expect(digestNow($a[0] as HTMLCanvasElement)).to.not.equal(before),
        );
      });

    cy.wait(2000); // let the force simulation settle
    repaints((c) => swipe(c, 300, 600, 120, 450));
    repaints((c) => pinch(c, 200, 500, 100, 320));

    // The canvas has no elements to click: find the densest blob of node-coloured
    // pixels and tap that, which is the middle of some node.
    cy.get("[data-testid=graph-canvas]").then(($c) => {
      const c = $c[0] as HTMLCanvasElement;
      const r = c.getBoundingClientRect();
      const ctx = c.getContext("2d")!;
      const dpr = c.width / r.width;
      const px = ctx.getImageData(0, 0, c.width, c.height).data;
      let best: [number, number] | null = null;
      let bestScore = 0;
      for (let y = 8; y < c.height - 8; y += 4)
        for (let x = 8; x < c.width - 8; x += 4) {
          let n = 0;
          for (let dy = -8; dy <= 8; dy += 4)
            for (let dx = -8; dx <= 8; dx += 4) {
              const i = ((y + dy) * c.width + (x + dx)) * 4;
              const hi = Math.max(px[i], px[i + 1], px[i + 2]);
              const lo = Math.min(px[i], px[i + 1], px[i + 2]);
              if (hi > 120 && hi - lo > 50) n++;
            }
          if (n > bestScore) {
            bestScore = n;
            best = [r.left + x / dpr, r.top + y / dpr];
          }
        }
      expect(best, "a node on the canvas").to.not.equal(null);
      tap(c, best![0], best![1]);
    });
    cy.get("[data-testid=graph-canvas]").should("not.exist");
  });

  it("keeps the Map where the reader left it when the store changes", () => {
    goTo("map");
    cy.get("[data-testid=map] .leaflet-pane").should("exist");
    // Tiles do not load offline, so read the view the map itself reports.
    const view = () =>
      cy
        .get("[data-testid=map]")
        .then(($m) => `${$m.attr("data-zoom")}@${$m.attr("data-center")}`);

    // The Places arrive after the map, and fitting them drops the zoom from the
    // opening 6; wait for that before touching the controls.
    cy.get("[data-testid=map] .leaflet-tooltip.map-label").should(
      "have.length.greaterThan",
      1,
    );
    cy.get("[data-testid=map]").should(($m) =>
      expect(Number($m.attr("data-zoom"))).to.be.lessThan(6),
    );
    cy.get("[data-testid=map]")
      .invoke("attr", "data-zoom")
      .then((fitted) => {
        cy.get(".leaflet-control-zoom-in").click().click();
        cy.get("[data-testid=map]").should(($m) =>
          expect(Number($m.attr("data-zoom"))).to.be.greaterThan(
            Number(fitted),
          ),
        );
      });
    view().then((zoomed) => {
      // Any store update re-renders the view; the map must not refit itself.
      cy.get("[data-sidebar=trigger]").first().click();
      cy.get("[data-sidebar=sidebar][data-mobile=true]").should("be.visible");
      cy.get("body").type("{esc}");
      cy.get("[data-sidebar=sidebar][data-mobile=true]").should("not.exist");
      view().should("equal", zoomed);
    });
  });
});
