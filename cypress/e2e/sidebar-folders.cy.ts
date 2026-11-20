// Folders in the sidebar (PLAN §31): Notes and Compositions drawn as a tree of
// the folders inside `Notes/` and `Compositions/`, read-only here. The demo
// Vault has a hand-made `Notes/Sermons/2026/` holding "Week 2" and "Week 10".
const folder = (key: string) => `[data-testid=folder-tree-note] [data-testid=folder][data-folder="${key}"]`;
const row = (key: string) => `${folder(key)} > [data-testid=folder-row]`;

describe("Sidebar Folders", () => {
  beforeEach(() => {
    cy.window().then((w) => w.localStorage.removeItem("synesis.sidebar.folders"));
    cy.openApp();
  });

  it("shows a hand-made Folder, folded, with its count, Folders before documents", () => {
    cy.get(row("Sermons")).should("have.attr", "aria-expanded", "false");
    cy.get(`${folder("Sermons")} > [data-testid=folder-count]`).should("have.text", "2");
    cy.get("[data-testid=folder-tree-note] > [data-testid=folder]").first().should("have.attr", "data-folder", "Sermons");
    cy.get("[data-testid=folder-tree-note]").should("not.contain", "Week 2");
  });

  it("folds and unfolds, in natural order, and opens a document", () => {
    cy.get(row("Sermons")).click();
    cy.get(row("Sermons/2026")).should("be.visible").click();
    cy.get(`${folder("Sermons/2026")} [data-testid=doc-item]`).then(($d) => {
      expect([...$d].map((e) => e.textContent?.trim())).to.deep.equal(["Week 2", "Week 10"]);
    });
    cy.contains(`${folder("Sermons/2026")} [data-testid=doc-item]`, "Week 10").click();
    cy.get("[data-testid=doc-title]").should("have.value", "Week 10");
    cy.get(row("Sermons")).click();
    cy.get("[data-testid=folder-tree-note]").should("not.contain", "Week 10");
  });

  it("unfolds the Folders holding the open document, and remembers open Folders across a reload", () => {
    cy.openDoc("Week 2");
    cy.get(row("Sermons")).should("have.attr", "aria-expanded", "true");
    cy.get(row("Sermons/2026")).should("have.attr", "aria-expanded", "true");
    cy.get(`${folder("Sermons/2026")} [data-testid=doc-item][data-active=true]`).should("contain", "Week 2");
    cy.openApp();
    cy.get(row("Sermons/2026")).should("have.attr", "aria-expanded", "true");
  });

  it("shows a Folder made outside the app, and one holding nothing", () => {
    const root = Cypress.env("vault");
    cy.task("dir:make", `${root}/Notes/Kept empty`);
    cy.task("file:write", { path: `${root}/Notes/Outside/Deep/found.md`, text: "Made in Finder.\n" });
    cy.get(row("Outside"), { timeout: 10000 }).should("exist");
    cy.get(`${folder("Outside")} > [data-testid=folder-count]`).should("have.text", "1");
    cy.get(`${folder("Kept empty")} > [data-testid=folder-count]`).should("have.text", "0");
  });
});
