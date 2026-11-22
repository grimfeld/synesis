// Walks the Folders Tutorial (docs/tutorials/folders.en.md) step by step,
// doing what each step says, so a change to the sidebar's Folders that
// outdates the Tutorial fails here (PLAN §25.13).
const row = (key: string) => `[data-testid=folder-tree-note] [data-testid=folder][data-folder="${key}"] > [data-testid=folder-row]`;

const clearOpenFolders = () =>
  cy.window().then((w) => {
    for (const k of Object.keys(w.localStorage)) if (k.startsWith("synesis.sidebar.folders")) w.localStorage.removeItem(k);
  });

describe("Tutorial: Folders", () => {
  beforeEach(() => {
    cy.openApp();
    clearOpenFolders();
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

    // 2. A Folder's row folds and unfolds it; opening a Note inside unfolds its Folders.
    cy.tutorialStep(1);
    cy.get(row("Sermons")).click().should("have.attr", "aria-expanded", "true");
    cy.get(row("Sermons")).click().should("have.attr", "aria-expanded", "false");
    cy.tutorialCommand("nav.search");
    cy.get("[data-testid=palette] input[cmdk-input]").type("Week 10");
    cy.contains("[data-testid=palette] [data-testid=palette-doc]", "Week 10").click();
    cy.get("[data-testid=doc-title]").should("have.value", "Week 10");
    cy.get(row("Sermons/2026")).should("have.attr", "aria-expanded", "true");
    cy.tutorialNext();

    // 3. Try it once: make a Folder and move a Note into it.
    cy.tutorialStep(2);
    cy.get("[data-testid=group-menu-note]").click();
    cy.get("[data-testid=group-menu-new-folder]").click();
    cy.get("[data-testid=folder-name-input]").type("Sermons 2026");
    cy.get("[data-testid=folder-name-submit]").click();
    cy.get(`${row("Sermons 2026")}`).should("exist");
    cy.task("file:exists", `${Cypress.env("vault")}/Notes/Sermons 2026`).should("equal", true);
    cy.contains("[data-testid=folder-tree-note] [data-testid=doc-row]", "Reading plan").find("[data-testid=doc-menu]").click();
    cy.get("[data-testid=doc-menu-move]").click();
    cy.get("[data-testid=folder-pick][data-folder='Sermons 2026']").click();
    cy.docByTitle("Reading plan").its("path").should("equal", "Notes/Sermons 2026/reading plan.md");
    cy.get('[data-testid=folder-tree-note] [data-folder="Sermons 2026"] > [data-testid=folder-count]').should("have.text", "1");
    // The step's Command link is the same move, from the open Note.
    cy.tutorialCommand("doc.move_to_folder");
    cy.get("[data-testid=folder-picker]").should("be.visible");
    cy.get("body").type("{esc}");
    cy.get("[data-testid=folder-picker]").should("not.exist");
    cy.tutorialDone();
  });
});
