// Walks the Versions Tutorial (docs/tutorials/versions.en.md) step by step on
// the demo vault's "Talk on endurance", so a change to Versions that outdates
// the Tutorial fails here (PLAN §24.13).
describe("Tutorial: Versions", () => {
  beforeEach(() => cy.openApp());

  it("can be followed to the end", () => {
    // Opened from the Composition editor, which lists it.
    cy.openDoc("Talk on endurance");
    cy.openTutorial("versions");

    // 1. The side panel has a Versions section.
    cy.tutorialStep(0);
    cy.get("[data-testid=right-panel] [data-testid=versions]").should("exist");
    cy.get("[data-testid=right-panel]").should("contain", "No Version saved yet.");
    cy.tutorialNext();

    // 2. Name a moment and save it.
    cy.tutorialStep(1);
    cy.get("input[aria-label='Save version']").type("Before this Tutorial");
    cy.get("[data-testid=right-panel]").contains("button", "Save version").click();
    cy.get("[data-testid=version-item]").should("have.length", 1).and("contain", "Before this Tutorial");
    cy.tutorialNext();

    // 3. Add a line, then open the Version: the line is marked +.
    cy.tutorialStep(2);
    cy.get(".cm-content").click().type("{ctrl}{end}");
    cy.get(".cm-content").type("{enter}Added for the Tutorial.");
    cy.wait(1000); // the editor's save is debounced
    cy.get("[data-testid=version-item] button").first().click();
    cy.get("[data-testid=version-dialog]").should("be.visible");
    cy.get("[data-testid=version-stats]").should("contain", "+1");
    cy.get("[data-testid=version-diff]").should("contain", "Added for the Tutorial.");
    cy.tutorialNext();

    // 4. Restore: the line goes as a new edit; history and the Version remain.
    cy.tutorialStep(3);
    cy.contains("button", "Restore this text").click();
    cy.get("[data-testid=version-dialog]").should("not.exist");
    cy.get(".cm-content").should("not.contain", "Added for the Tutorial.");
    cy.wait(1000);
    cy.docByTitle("Talk on endurance").then((d) => {
      cy.task<string>("file:read", `${Cypress.env("vault")}/${d.path}`).then((text) => {
        expect(text).not.to.contain("Added for the Tutorial.");
      });
    });
    cy.get("[data-testid=right-panel]").contains("Browse history").click();
    cy.get("[data-testid=history]").parent().find("li").should("have.length.at.least", 2);
    cy.get("[data-testid=version-item]").should("have.length", 1);
    cy.tutorialNext();

    // 5. Do it once: a Version named for the occasion.
    cy.tutorialStep(4);
    cy.get("input[aria-label='Save version']").type("As delivered, 2026-10-04");
    cy.get("[data-testid=right-panel]").contains("button", "Save version").click();
    cy.get("[data-testid=version-item]").should("have.length", 2).and("contain", "As delivered, 2026-10-04");
    cy.tutorialDone();
  });
});
