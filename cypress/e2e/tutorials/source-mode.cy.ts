// Walks the Live Preview & Source mode Tutorial
// (docs/tutorials/source-mode.en.md) step by step, doing what each step says,
// so a change to the editor that outdates the Tutorial fails here (PLAN §24.13).
describe("Tutorial: Live Preview & Source mode", () => {
  beforeEach(() => cy.openApp());

  it("can be followed to the end", () => {
    // The editor lists this Tutorial, so start from a Note.
    cy.openDoc("Endurance in trials");
    cy.get(".cm-content").should("contain", "Endurance in trials");
    cy.openTutorial("source-mode");

    // 1. Open a Note with Search; syntax is hidden except on the line clicked.
    cy.tutorialStep(0);
    cy.tutorialCommand("nav.search");
    cy.get("[data-testid=palette] input[cmdk-input]").type("endurance in trials");
    cy.get("[data-testid=palette] [cmdk-item]").first().should("contain", "Endurance in trials");
    cy.get("[data-testid=palette] input[cmdk-input]").type("{enter}");
    cy.get("[data-testid=doc-title]").should("have.value", "Endurance in trials");
    cy.get(".cm-line.cm-md-heading-line-2").first().should("contain", "Cross-references").click();
    cy.get(".cm-content").should("contain", "## Cross-references").and("not.contain", "## To do");
    cy.tutorialNext();

    // 2. Source mode shows every line as stored; the header button is on.
    cy.tutorialStep(1);
    cy.tutorialCommand("editor.source");
    cy.get(".cm-content").should("contain", "## To do").and("contain", "- [ ] Reread Jas 1");
    cy.get("button[aria-label='Live Preview']").should("have.attr", "aria-pressed", "true");
    cy.tutorialNext();

    // 3. Do it once: a new Note, typed in Source mode, then Live Preview.
    cy.tutorialStep(2);
    cy.tutorialCommand("create.note");
    cy.get("[data-testid=new-doc-form] [data-testid=new-doc-title]").type("Trying Source mode");
    cy.get("[data-testid=submit-doc]").click();
    cy.get("[data-testid=doc-title]").should("have.value", "Trying Source mode");
    cy.get(".cm-content").click().type("## A heading{enter}**some bold words**");
    cy.get(".cm-content").should("contain", "## A heading");
    cy.tutorialCommand("editor.source");
    cy.get("button[aria-label='Source mode']").should("have.attr", "aria-pressed", "false");
    // The heading's marks are hidden off the cursor's line; the words stay.
    cy.get(".cm-content").should("not.contain", "## A heading").and("contain", "A heading");
    // The file holds exactly what was typed: switching modes changed nothing.
    cy.wait(1000);
    cy.docByTitle("Trying Source mode").then((d) => {
      cy.task<string>("file:read", `${Cypress.env("vault")}/${d.path}`).then((text) => {
        expect(text).to.contain("## A heading\n**some bold words**");
      });
    });
    cy.tutorialDone();
  });
});
