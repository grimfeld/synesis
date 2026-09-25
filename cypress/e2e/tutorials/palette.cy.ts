// Walks the Command Palette Tutorial (docs/tutorials/palette.en.md) step by
// step, doing what each step says, so a change to the palette that outdates
// the Tutorial fails here (PLAN §25.13).
describe("Tutorial: The Command Palette", () => {
  beforeEach(() => cy.openApp());

  it("can be followed to the end", () => {
    cy.openTutorial("palette");

    // 1. Open Search and type part of a title; Enter opens it.
    cy.tutorialStep(0);
    cy.tutorialCommand("nav.search");
    cy.get("[data-testid=palette] input[cmdk-input]").type("psalm 23");
    cy.get("[data-testid=palette] [cmdk-item]").first().should("contain", "Psalm 23 reflections");
    cy.get("[data-testid=palette] input[cmdk-input]").type("{enter}");
    cy.get("[data-testid=doc-title]").should("have.value", "Psalm 23 reflections");
    cy.tutorialNext();

    // 2. `>` lists Commands; the Command palette link opens it that way.
    cy.tutorialStep(1);
    cy.tutorialCommand("nav.commands");
    cy.get("[data-testid=palette] input[cmdk-input]").should("have.value", ">");
    cy.get("[data-testid=palette] [cmdk-item]").should("contain", "New Note");
    cy.get("body").type("{esc}");
    cy.tutorialNext();

    // 3. Do it once: `>timeline`, Enter, and the Tutorial stays open beside it.
    cy.tutorialStep(2);
    cy.palette(">timeline");
    cy.get("[data-testid=palette] input[cmdk-input]").type("{enter}");
    cy.get("h1").should("contain", "Timeline");
    cy.get("[data-testid=tutorial-panel]").should("be.visible");
    cy.tutorialDone();
  });
});
