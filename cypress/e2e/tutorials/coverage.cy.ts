// Walks the Coverage Tutorial (docs/tutorials/coverage.en.md) step by step,
// doing what each step says, so a change to Coverage that outdates the
// Tutorial fails here (PLAN §22.13).
describe("Tutorial: Coverage", () => {
  beforeEach(() => cy.openApp());

  it("can be followed to the end", () => {
    cy.get("[data-testid=nav-coverage]").click();
    cy.get("h1").should("contain", "Coverage");
    cy.openTutorial("coverage");

    // 1. The grid: a square per Chapter, shaded by how many documents mention it;
    //    the header counts the Chapters written about, out of 1,189.
    cy.tutorialStep(0);
    cy.get("[data-testid=coverage-cell]").should("have.length", 1189);
    cy.query<{ count: number }[]>({ kind: "coverage" }).then((cells) => {
      cy.get("[data-testid=coverage-cell]:not([data-count='0'])").should("have.length", cells.length);
      cy.contains("[data-slot=badge]", "/ 1189").should("contain", `${cells.length} / 1189`);
    });
    cy.tutorialNext();

    // 2. A square names its Chapter and count; a Book's name opens the Book's page,
    //    and Go to Coverage comes back.
    cy.tutorialStep(1);
    cy.get("[data-testid=coverage-cell][title^='Romans 8 ']").should("have.attr", "title").and("match", /^Romans 8 · \d+$/);
    cy.contains("[data-testid=coverage-book]", "Romans").click();
    cy.get("[data-testid=hub-header]").should("contain", "Romans");
    cy.get("[data-testid=hub-strip]").should("exist");
    cy.tutorialCommand("nav.coverage");
    cy.get("h1").should("contain", "Coverage");
    cy.tutorialNext();

    // 3. Do it once: the darkest square is the most-written-about Chapter; it opens its page.
    cy.tutorialStep(2);
    cy.query<{ count: number }[]>({ kind: "coverage" }).then((cells) => {
      const most = Math.max(...cells.map((c) => c.count));
      expect(most, "the demo vault mentions some Chapter").to.be.greaterThan(0);
      cy.get(`[data-testid=coverage-cell][data-count='${most}']`)
        .first()
        .then(($cell) => {
          const chapter = $cell.attr("title")!.split(" · ")[0];
          cy.wrap($cell).click();
          cy.get("[data-testid=hub-header]").should("contain", chapter);
          cy.get("[data-testid=hub-strip]").should("exist");
          cy.get("[data-testid=hub-mentions]").should("exist");
        });
    });
    cy.tutorialDone();
  });
});
