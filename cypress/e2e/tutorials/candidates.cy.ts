// Walks the Candidates Tutorial (docs/tutorials/candidates.en.md) step by
// step, doing what each step says, so a change to the Candidates panel that
// outdates the Tutorial fails here (PLAN §25.13).
describe("Tutorial: Candidates", () => {
  beforeEach(() => cy.openApp());

  it("can be followed to the end", () => {
    // The Composition editor lists this Tutorial.
    cy.openDoc("Talk on endurance");
    cy.get("[data-testid=doc-title]").should("have.value", "Talk on endurance");
    cy.openTutorial("candidates");

    // 1. Home's Compositions in progress count Candidates and open the Composition.
    cy.tutorialStep(0);
    cy.tutorialCommand("nav.home");
    cy.get("[data-testid=home-progress]")
      .contains("button", "Talk on endurance")
      .should("contain", "candidate")
      .click();
    cy.get("[data-testid=doc-title]").should("have.value", "Talk on endurance");
    cy.tutorialNext();

    // 2. Candidate material in the right panel; open one and come back.
    cy.tutorialStep(1);
    cy.get("[data-testid=right-panel]").should("contain", "Candidate material");
    cy.get("[data-testid=right-panel] [data-testid=candidates]")
      .parent()
      .contains("button", "Undeserved kindness in Romans")
      .should("contain", "#endurance")
      .click();
    cy.get("[data-testid=doc-title]").should("have.value", "Undeserved kindness in Romans");
    cy.tutorialCommand("nav.back");
    cy.get("[data-testid=doc-title]").should("have.value", "Talk on endurance");
    cy.tutorialNext();

    // 3. Do it once: link the Candidate from a new line; it moves to Used.
    cy.tutorialStep(2);
    cy.get(".cm-content").click().type("{ctrl}{end}");
    cy.get(".cm-content").type("{enter}See also ");
    cy.tutorialCommand("editor.link");
    // Typed whole between the brackets the Command put in (see the note in
    // compositions.cy.ts on why the list is not driven).
    cy.focused().type("Undeserved kindness in Romans");
    cy.get("body").type("{esc}");
    cy.get("[data-testid=right-panel] [data-testid=candidates]")
      .parent()
      .should("not.contain", "Undeserved kindness in Romans");
    cy.get("[data-testid=right-panel]").contains("Used in this Composition").click();
    cy.get("[data-testid=right-panel] [data-testid=used-material]")
      .parent()
      .should("contain", "Undeserved kindness in Romans");
    cy.tutorialDone();
  });
});
