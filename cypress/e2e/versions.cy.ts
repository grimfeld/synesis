// Versions (ADR 0007): name a moment of a Composition, compare, restore,
// browse unnamed history, delete.
describe("Versions", () => {
  beforeEach(() => cy.openApp());

  it("save, edit, compare, restore, browse history, delete", () => {
    cy.openDoc("Talk on endurance");
    cy.get("[data-testid=right-panel]").should("contain", "Versions");
    cy.get("[data-testid=right-panel]").should(
      "contain",
      "No Version saved yet.",
    );
    cy.get("input[aria-label='Save version']").type("Before edits");
    cy.get("[data-testid=right-panel]")
      .contains("button", "Save version")
      .click();
    cy.get("[data-testid=version-item]")
      .should("have.length", 1)
      .and("contain", "Before edits");

    // Edit the text, then compare with the Version.
    cy.get(".cm-content").click().type("{ctrl}{end}");
    cy.get(".cm-content").type("{enter}Added later.");
    cy.wait(1000);
    cy.get("[data-testid=version-item] button").first().click();
    cy.get("[data-testid=version-dialog]").should("be.visible");
    cy.get("[data-testid=version-stats]").should("contain", "+1");
    cy.get("[data-testid=version-diff]").should("contain", "Added later.");

    // Restore writes the old text back as a new edit.
    cy.contains("button", "Restore this text").click();
    cy.get("[data-testid=version-dialog]").should("not.exist");
    cy.get(".cm-content").should("not.contain", "Added later.");
    cy.wait(1000);
    cy.docByTitle("Talk on endurance").then((d) => {
      cy.task<string>("file:read", `${Cypress.env("vault")}/${d.path}`).then(
        (text) => {
          expect(text).not.to.contain("Added later.");
        },
      );
    });

    // Unnamed history has every save; the Version is still there.
    cy.get("[data-testid=right-panel]").contains("Browse history").click();
    cy.get("[data-testid=history]")
      .parent()
      .find("li")
      .should("have.length.at.least", 2);
    cy.get("[data-testid=version-item]").should("have.length", 1);

    cy.get("button[aria-label='Delete version: Before edits']").click();
    cy.get("[data-testid=version-item]").should("not.exist");
    cy.get("[data-testid=right-panel]").should(
      "contain",
      "No Version saved yet.",
    );
  });

  it("a Version survives reopening the document", () => {
    cy.openDoc("Student talk on prayer");
    cy.get("input[aria-label='Save version']").type("Draft one");
    cy.get("[data-testid=right-panel]")
      .contains("button", "Save version")
      .click();
    cy.get("[data-testid=version-item]").should("contain", "Draft one");
    cy.get("[data-testid=nav-home]").click();
    cy.openDoc("Student talk on prayer");
    cy.get("[data-testid=version-item]").should("contain", "Draft one");
  });
});
