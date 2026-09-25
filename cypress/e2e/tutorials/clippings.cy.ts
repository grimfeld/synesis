// Walks the Clippings Tutorial (docs/tutorials/clippings.en.md) step by step,
// doing what each step says, so a change to the Clippings view or the capture
// box that outdates the Tutorial fails here (PLAN §22.13).
describe("Tutorial: Clippings", () => {
  beforeEach(() => cy.openApp());

  it("can be followed to the end", () => {
    cy.runCommand("Go to Clippings");
    cy.get("[data-testid=clippings]").should("exist");
    cy.openTutorial("clippings");

    // 1. Every Clipping as its own words, with its Citation; narrow and clear.
    cy.tutorialStep(0);
    cy.tutorialCommand("nav.clippings");
    cy.get("[data-testid=clipping-card]").should("have.length", 4);
    cy.get("[data-testid=clipping-card]")
      .contains("Endurance is not merely putting up")
      .parent()
      .find("[data-testid=clipping-citation]")
      .should("contain", "Keep Enduring with Joy")
      .and("contain", "par. 12");
    cy.get("[data-testid=clippings-tag-endurance]").click();
    cy.get("[data-testid=clipping-card]").should("have.length", 1);
    cy.get("[data-testid=clippings-clear]").click();
    cy.get("[data-testid=clipping-card]").should("have.length", 4);
    cy.tutorialNext();

    // 2. A Clipping opens on its Citation, with no title.
    cy.tutorialStep(1);
    cy.get("[data-testid=clipping-card]").contains("Endurance is not merely putting up").click();
    cy.get("[data-testid=doc-citation]").should("contain", "Keep Enduring with Joy").and("contain", "par. 12");
    cy.get("[data-testid=doc-title]").should("not.exist");
    cy.tutorialNext();

    // 3. A Source from the Library; its page has the capture box.
    cy.tutorialStep(2);
    cy.tutorialCommand("nav.library");
    cy.get("[data-testid=shelf-book]")
      .contains("[data-testid=library-card]", "Jesus, the Way")
      .scrollIntoView()
      .click();
    cy.hubTitle("Jesus, the Way");
    cy.get("[data-testid=hub-capture]").should("exist");
    cy.tutorialNext();

    // 4. Do it once: keep a Clipping from the box, then find it in Clippings.
    cy.tutorialStep(3);
    cy.tutorialCommand("doc.capture");
    cy.focused().should("have.attr", "data-testid", "capture-text");
    cy.get("[data-testid=capture-as-clipping]").should("have.attr", "aria-pressed", "true");
    cy.get("[data-testid=capture-text]").type("Words from the Tutorial, kept as they were written.");
    cy.get("[data-testid=capture-locator]").type("chap. 5");
    cy.get("[data-testid=capture-submit]").click();
    cy.hubTitle("Jesus, the Way");
    cy.get("[data-testid=hub-clippings]").within(() => {
      cy.contains("Words from the Tutorial, kept as they were written.");
      cy.contains("chap. 5");
    });
    cy.tutorialCommand("nav.clippings");
    cy.get("[data-testid=clipping-card]").should("have.length", 5);
    cy.get("[data-testid=clipping-card]")
      .first()
      .should("contain", "Words from the Tutorial, kept as they were written.")
      .find("[data-testid=clipping-citation]")
      .should("contain", "Jesus, the Way")
      .and("contain", "chap. 5");
    cy.tutorialDone();
  });
});
