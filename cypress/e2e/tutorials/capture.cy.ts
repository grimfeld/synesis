// Walks the Quick capture & Notes Tutorial (docs/tutorials/capture.en.md)
// step by step, doing what each step says, so a change to Home, the capture
// dialog or the New Note dialog that outdates the Tutorial fails here
// (PLAN §22.13).
describe("Tutorial: Quick capture & Notes", () => {
  beforeEach(() => cy.openApp());

  it("can be followed to the end", () => {
    // The app opens on Home, which lists this Tutorial.
    cy.openTutorial("capture");

    // 1. Go to Home: the Quick capture box is at the top.
    cy.tutorialStep(0);
    cy.tutorialCommand("nav.home");
    cy.get("h1").should("contain", "Home");
    cy.get("[data-testid=home-quick]").should("contain", "Quick capture").find("textarea").should("exist");
    cy.tutorialNext();

    // 2. The Quick capture Command opens the same box as a dialog.
    cy.tutorialStep(1);
    cy.tutorialCommand("create.quick");
    cy.get("[role=dialog]").should("contain", "Quick capture").find("textarea").should("exist");
    cy.get("body").type("{esc}");
    cy.get("[role=dialog]").should("not.exist");
    cy.tutorialNext();

    // 3. Notes are listed in the sidebar under Notes, and the latest on Home's Recent.
    cy.tutorialStep(2);
    cy.get("[data-testid=group-note]").should("contain", "Notes");
    cy.get("[data-testid=doc-item]").should("contain", "Psalm 23 reflections");
    cy.get("[data-testid=home-recent]").should("contain", "Endurance in trials");
    cy.tutorialNext();

    // 4. New Note asks for a Title.
    cy.tutorialStep(3);
    cy.tutorialCommand("create.note");
    cy.get("[data-testid=new-doc-form]").should("contain", "Note");
    cy.get("[data-testid=new-doc-title]").should("be.visible");
    cy.get("body").type("{esc}");
    cy.get("[data-testid=new-doc-form]").should("not.exist");
    cy.tutorialNext();

    // 5. Do it once: capture on Home, then open the Note from Recent.
    cy.tutorialStep(4);
    cy.get("[data-testid=home-quick] textarea").type("Captured while following the tutorial, see Ro 12:2.");
    cy.get("[data-testid=home-quick]").contains("button", "Create").click();
    cy.get("[data-testid=home-quick] textarea").should("have.value", "");
    cy.get("h1").should("contain", "Home");
    // Titled with the moment it was captured, and first in Recent.
    cy.get("[data-testid=home-recent] li").first().find("button").first().click();
    cy.get("[data-testid=doc-title]")
      .invoke("val")
      .should("match", /^\d{4}-\d{2}-\d{2} \d{2}\.\d{2}$/);
    cy.get(".cm-content").should("contain", "Captured while following the tutorial");
    cy.get(".cm-passage").should("contain", "Ro 12:2");
    cy.tutorialDone();
  });
});
