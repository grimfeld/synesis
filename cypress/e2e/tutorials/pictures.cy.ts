// Walks the Pictures Tutorial (docs/tutorials/pictures.en.md) step by step,
// doing what each step says, so a change to how Pictures go in that outdates
// the Tutorial fails here (PLAN §25.13).
// `a35094` in a stored name: the first hex digits of the fixture's SHA-256.
// It is 64×40, so it is stored byte for byte (ADR 0019).
describe("Tutorial: Pictures", () => {
  beforeEach(() => cy.openApp());

  it("can be followed to the end", () => {
    cy.openDoc("Endurance in trials");
    cy.get(".cm-content").should("contain", "Endurance in trials");
    cy.openTutorial("pictures");

    // 1. Open a Note with Search, then drop a picture on the text.
    cy.tutorialStep(0);
    cy.tutorialCommand("nav.search");
    cy.get("[data-testid=palette] input[cmdk-input]").type("endurance in trials");
    cy.get("[data-testid=palette] [cmdk-item]").first().should("contain", "Endurance in trials");
    cy.get("[data-testid=palette] input[cmdk-input]").type("{enter}");
    cy.get("[data-testid=doc-title]").should("have.value", "Endurance in trials");
    cy.get(".cm-content").selectFile("cypress/fixtures/athens.png", { action: "drag-drop" });
    cy.get("[data-testid=picture][data-state=shown]").should("exist");
    cy.tutorialNext();

    // 2. Clicking the picture shows its stored line; leaving the line brings it back.
    cy.tutorialStep(1);
    cy.get(".cm-line").first().click();
    cy.get(".cm-content").should("not.contain", "![[Attachments/endurance in trials a35094.png]]");
    cy.get("[data-testid=picture] img").click();
    cy.get(".cm-content").should("contain", "![[Attachments/endurance in trials a35094.png]]");
    cy.get(".cm-line").first().click();
    cy.get(".cm-content").should("not.contain", "![[Attachments/endurance in trials a35094.png]]");
    cy.tutorialNext();

    // 3. Do it once: a new Note, and Insert picture.
    cy.tutorialStep(2);
    cy.tutorialCommand("create.note");
    cy.get("[data-testid=new-doc-form] [data-testid=new-doc-title]").type("Trying pictures");
    cy.get("[data-testid=submit-doc]").click();
    cy.get("[data-testid=doc-title]").should("have.value", "Trying pictures");
    cy.get(".cm-content").click();
    cy.tutorialCommand("editor.picture");
    cy.get("[data-testid=picture-input]").selectFile("cypress/fixtures/athens.png", { force: true });
    cy.get("[data-testid=picture][data-state=shown]").should("exist");
    cy.task<boolean>("file:exists", `${Cypress.env("vault")}/Attachments/trying pictures a35094.png`).should("eq", true);
    cy.tutorialDone();
  });
});
