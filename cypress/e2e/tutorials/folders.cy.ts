// Walks the Folders Tutorial (docs/tutorials/folders.en.md) step by step,
// doing what each step says, so a change to the sidebar's Folders that
// outdates the Tutorial fails here (PLAN §25.13).
const row = (key: string) => `[data-testid=folder-tree-note] [data-testid=folder][data-folder="${key}"] > [data-testid=folder-row]`;

describe("Tutorial: Folders", () => {
  beforeEach(() => {
    cy.window().then((w) => w.localStorage.removeItem("synesis.sidebar.folders"));
    cy.openApp();
  });

  it("can be followed to the end", () => {
    cy.get("[data-testid=sidebar-tutorial-note]").click();
    cy.get("[data-testid=tutorial-panel]").should("be.visible");
    cy.get("[data-testid=tutorial-panel]").then(($p) => {
      if ($p.find("[data-testid=tutorial-list]").length) cy.get('[data-testid=tutorial-list-item][data-id="folders"]').click();
    });
    cy.get("[data-testid=tutorial-body]").should("have.attr", "data-id", "folders");

    // 1. Folders first, then documents, each with a count.
    cy.tutorialStep(0);
    cy.get("[data-testid=folder-tree-note] > [data-testid=folder]").first().should("have.attr", "data-folder", "Sermons");
    cy.get('[data-testid=folder-tree-note] [data-folder="Sermons"] > [data-testid=folder-count]').should("have.text", "2");
    cy.tutorialNext();

    // 2. A Folder's row folds and unfolds it.
    cy.tutorialStep(1);
    cy.get(row("Sermons")).click().should("have.attr", "aria-expanded", "true");
    cy.get(row("Sermons")).click().should("have.attr", "aria-expanded", "false");
    cy.tutorialNext();

    // 3. Try it once: open a Note inside a Folder; its Folders unfold.
    cy.tutorialStep(2);
    cy.tutorialCommand("nav.search");
    cy.get("[data-testid=palette] input[cmdk-input]").type("Week 10");
    cy.contains("[data-testid=palette] [data-testid=palette-doc]", "Week 10").click();
    cy.get("[data-testid=doc-title]").should("have.value", "Week 10");
    cy.get(row("Sermons")).should("have.attr", "aria-expanded", "true");
    cy.get(row("Sermons/2026")).should("have.attr", "aria-expanded", "true");
    cy.tutorialDone();
  });
});
