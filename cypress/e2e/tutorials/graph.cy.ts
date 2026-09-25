// Walks the Graph Tutorial (docs/tutorials/graph.en.md) step by step, doing
// what each step says, so a change to the Graph that outdates the Tutorial
// fails here (PLAN §25.13). The Graph is a canvas: where the DOM cannot say
// what is drawn, the spec reads the pixels, as cypress/e2e/graph.cy.ts does.
export {};

const canvas = "[data-testid=graph-canvas]";
const counts = "[data-testid=graph-counts]";

/** "nodes · edges" in the header, as numbers. */
const readCounts = (text: string) => text.split("·").map((x) => parseInt(x.trim(), 10));

/** A cheap hash of the painted pixels: same number twice means nothing moved. */
const frame = () =>
  cy.get<HTMLCanvasElement>(canvas).then(($c) => {
    const c = $c[0];
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 997) h = (h * 31 + d[i]) >>> 0;
    return h;
  });

/** Wait until the picture stops changing: the layout has come to rest. */
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

/**
 * Where the one undimmed Note is drawn, in CSS pixels of the canvas. A search
 * draws every node that does not match at 30% opacity on a transparent canvas,
 * so the only opaque pixels in the Note colour are the matching Note's dot.
 */
const matchedNoteAt = () =>
  cy.window().then((win) =>
    cy.get<HTMLCanvasElement>(canvas).then(($c) => {
      const c = $c[0];
      const hex = win.getComputedStyle(win.document.documentElement).getPropertyValue("--c-note").trim();
      expect(hex, "--c-note is a hex colour").to.match(/^#[0-9a-f]{6}$/i);
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      let sx = 0,
        sy = 0,
        n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 240) continue;
        if (Math.abs(d[i] - r) > 16 || Math.abs(d[i + 1] - g) > 16 || Math.abs(d[i + 2] - b) > 16) continue;
        const p = i / 4;
        sx += p % c.width;
        sy += Math.floor(p / c.width);
        n++;
      }
      expect(n, "pixels of the matching Note's dot").to.be.greaterThan(0);
      const scale = c.width / c.clientWidth;
      return { x: sx / n / scale, y: sy / n / scale };
    }),
  );

describe("Tutorial: The Graph", () => {
  beforeEach(() => cy.openApp());

  it("can be followed to the end", () => {
    cy.get("[data-testid=nav-graph]").click();
    cy.get(canvas).should("be.visible");
    cy.get(counts).should("not.contain", "0 · 0");
    cy.openTutorial("graph");

    // 1. Look it over: it settles, and Fit all frames it.
    cy.tutorialStep(0);
    waitForRest();
    cy.get("[data-testid=graph-fit]").click();
    waitForRest();
    cy.tutorialNext();

    // 2. Scripture level Book folds Chapters into Books; back to Chapter restores them.
    cy.tutorialStep(1);
    cy.get(counts)
      .invoke("text")
      .then((before) => {
        const [nodes] = readCounts(before);
        cy.get("[data-testid=graph-level]").click();
        cy.get("[data-testid=graph-level-book]").click();
        cy.get(counts).should(($b) => expect(readCounts($b.text())[0]).to.be.lessThan(nodes));
        cy.get("[data-testid=graph-level]").click();
        cy.get("[data-testid=graph-level-chapter]").click();
        cy.get(counts).should("have.text", before);
      });
    cy.tutorialNext();

    // 3. Search dims; turning Scripture off leaves only the documents.
    cy.tutorialStep(2);
    cy.get("[data-testid=graph-search]").type("paul").should("have.value", "paul");
    cy.get("[data-testid=graph-search]").clear();
    cy.query<{ nodes: { type: string }[] }>({ kind: "graph", level: "chapter" }).then((g) => {
      const docs = g.nodes.filter((n) => !["book", "chapter", "verse"].includes(n.type)).length;
      cy.get("[data-testid=graph-type-chapter]").click();
      cy.get(counts).should(($b) => expect(readCounts($b.text())[0]).to.equal(docs));
    });
    cy.tutorialNext();

    // 4. Do it once: search a Note's title and click its dot; the Note opens.
    cy.tutorialStep(3);
    waitForRest();
    cy.get("[data-testid=graph-fit]").click();
    cy.get("[data-testid=graph-search]").type("Psalm 23 reflections");
    waitForRest();
    matchedNoteAt().then(({ x, y }) => {
      cy.get(canvas).click(x, y);
    });
    cy.get("[data-testid=doc-title]").should("have.value", "Psalm 23 reflections");
    cy.tutorialCommand("nav.graph");
    cy.get(canvas).should("be.visible");
    cy.get("[data-testid=tutorial-panel]").should("be.visible");
    cy.tutorialDone();
  });
});
