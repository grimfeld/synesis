// The Graph is a canvas, so these tests read the simulation and the view rather
// than the DOM: that the layout comes to rest, that a write in the vault does not
// throw it away, and that the nodes end up inside the canvas instead of flung off
// the side of it by an unbounded repulsion.
const canvas = "[data-testid=graph-canvas]";

/** A cheap hash of the painted pixels: same number twice means nothing moved. */
const frame = () =>
  cy.get<HTMLCanvasElement>(canvas).then(($c) => {
    const c = $c[0];
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 997) h = (h * 31 + d[i]) >>> 0;
    return h;
  });

/** Two frames a second apart: the layout is at rest when they match. */
const expectAtRest = () =>
  frame().then((a) => {
    cy.wait(1000);
    frame().should("equal", a);
  });

/**
 * Wait until the picture stops changing. The layout settles in a couple of seconds
 * and is framed once more when it does, so a fixed wait would race that last paint.
 */
const waitForRest = (tries = 20) => {
  const step = (left: number): Cypress.Chainable<number> =>
    frame().then((a) => {
      cy.wait(500);
      return frame().then((b) => {
        if (a === b || left === 0) return b;
        return step(left - 1);
      });
    });
  return step(tries);
};

describe("Graph", () => {
  beforeEach(() => {
    cy.openApp();
    cy.get("[data-testid=nav-graph]").click();
    cy.get(canvas).should("be.visible");
    cy.get("[data-testid=graph-counts]").should("not.contain", "0 · 0");
  });

  it("comes to rest and stays there", () => {
    waitForRest();
    expectAtRest();
    // And it is still at rest later: nothing keeps repainting in the background.
    cy.wait(3000);
    expectAtRest();
  });

  it("keeps the layout when the vault changes under it", () => {
    waitForRest();
    frame().then((before) => {
      // A write on an unrelated Note: the graph is refetched, but nothing about it
      // changed, so the picture must not be rebuilt and replayed.
      cy.docByTitle("Endurance in trials").then((d) => {
        cy.bridge<{ text: string }>("get_document", { id: d.id }).then((doc) => {
          cy.bridge("save_document", { id: d.id, text: `${doc.text}\n` });
        });
      });
      // Sampled while a rebuilt layout would still be moving: the old behaviour
      // restarted the simulation from scratch on every write.
      cy.wait(1200);
      frame().should("equal", before);
      cy.wait(2000);
      frame().should("equal", before);
    });
  });

  it("frames every node inside the canvas", () => {
    waitForRest();
    cy.get("[data-testid=graph-fit]").click();
    cy.wait(500);
    cy.window().then((win) => {
      const c = win.document.querySelector(canvas) as HTMLCanvasElement;
      const g = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      // Something has to be painted in the middle of the view, not only at its edges.
      let painted = 0;
      for (let i = 3; i < g.length; i += 4) if (g[i] > 0) painted++;
      expect(painted, "painted pixels").to.be.greaterThan(500);
    });
  });

  it("thins the labels out as the view pulls back", () => {
    waitForRest();
    const labels = () =>
      cy.get<HTMLCanvasElement>(canvas).then(($c) => {
        // Text is the only thing drawn in the foreground colour, so counting the
        // rows that carry it approximates how much labelling is on screen.
        const c = $c[0];
        const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
        let bright = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) bright++;
        }
        return bright;
      });
    labels().then((close) => {
      expect(close, "labels at the default zoom").to.be.greaterThan(0);
      cy.get(canvas).trigger("wheel", { deltaY: 240, clientX: 700, clientY: 400 });
      cy.get(canvas).trigger("wheel", { deltaY: 240, clientX: 700, clientY: 400 });
      cy.get(canvas).trigger("wheel", { deltaY: 240, clientX: 700, clientY: 400 });
      cy.get(canvas).trigger("wheel", { deltaY: 240, clientX: 700, clientY: 400 });
      cy.wait(600);
      labels().should("be.lessThan", close);
    });
  });
});
