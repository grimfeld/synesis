// Folders in the sidebar (PLAN §31): Notes and Compositions drawn as a tree of
// the folders inside `Notes/` and `Compositions/`, read-only here. The demo
// Vault has a hand-made `Notes/Sermons/2026/` holding "Week 2" and "Week 10".
const folder = (key: string) => `[data-testid=folder-tree-note] [data-testid=folder][data-folder="${key}"]`;
const row = (key: string) => `${folder(key)} > [data-testid=folder-row]`;

const clearOpenFolders = () =>
  cy.window().then((w) => {
    for (const k of Object.keys(w.localStorage)) if (k.startsWith("synesis.sidebar.folders")) w.localStorage.removeItem(k);
  });

describe("Sidebar Folders", () => {
  beforeEach(() => {
    cy.openApp();
    clearOpenFolders();
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

  it("remembers open Folders in both groups", () => {
    cy.task("dir:make", `${Cypress.env("vault")}/Compositions/Talks`);
    cy.reload();
    cy.get(row("Sermons")).click();
    cy.get('[data-testid=folder-tree-composition] [data-folder="Talks"] > [data-testid=folder-row]').click();
    cy.openApp();
    cy.get(row("Sermons")).should("have.attr", "aria-expanded", "true");
    cy.get('[data-testid=folder-tree-composition] [data-folder="Talks"] > [data-testid=folder-row]').should("have.attr", "aria-expanded", "true");
  });

  it("leaves a Folder the reader folded folded while the open document is saved", () => {
    cy.openDoc("Week 2");
    cy.get(row("Sermons")).should("have.attr", "aria-expanded", "true").click();
    cy.get(".cm-content").first().click().type(" More.");
    // The save refreshes the document list; the fold stays.
    cy.wait(1500);
    cy.get(row("Sermons")).should("have.attr", "aria-expanded", "false");
  });

  it("shows a Folder made outside the app, and one holding nothing", () => {
    const root = Cypress.env("vault");
    cy.task("dir:make", `${root}/Notes/Kept empty`);
    cy.task("file:write", { path: `${root}/Notes/Outside/Deep/found.md`, text: "Made in Finder.\n" });
    // A page on the dev bridge hears no `vault:changed`; the watcher's half
    // (`Vault::folder_changed`) is tested in the engine.
    cy.reload();
    cy.get(row("Outside"), { timeout: 10000 }).should("exist");
    cy.get(`${folder("Outside")} > [data-testid=folder-count]`).should("have.text", "1");
    cy.get(`${folder("Kept empty")} > [data-testid=folder-count]`).should("have.text", "0");
  });
});

describe("Making and deleting Folders", () => {
  beforeEach(() => cy.openApp());
  const vaultDir = (rel: string) => `${Cypress.env("vault")}/${rel}`;
  const nameIt = (name: string) => {
    cy.get("[data-testid=folder-name-input]").clear().type(name);
    cy.get("[data-testid=folder-name-submit]").click();
  };

  it("makes a Folder from the group's menu, keeping its capitals", () => {
    cy.get("[data-testid=group-menu-note]").click();
    cy.get("[data-testid=group-menu-new-folder]").click();
    nameIt("Sermons 2026");
    cy.get("[data-testid=folder-name-dialog]").should("not.exist");
    cy.get(row("Sermons 2026")).should("exist");
    cy.get(`${folder("Sermons 2026")} > [data-testid=folder-count]`).should("have.text", "0");
    cy.task("file:exists", vaultDir("Notes/Sermons 2026")).should("equal", true);
  });

  it("makes a Folder inside a Folder, from its menu and by right-click", () => {
    cy.get(`${folder("Sermons")} > [data-testid=folder-menu]`).click();
    cy.get("[data-testid=folder-menu-new-folder]").click();
    nameIt("Advent");
    cy.get(row("Sermons")).click();
    cy.get(row("Sermons/Advent")).should("exist");
    cy.get(row("Sermons/Advent")).rightclick();
    cy.get("[data-testid=folder-menu-new-folder]").should("be.visible");
  });

  it("refuses a bad name with a message and writes nothing", () => {
    cy.get("[data-testid=group-menu-note]").click();
    cy.get("[data-testid=group-menu-new-folder]").click();
    for (const bad of [".hidden", "a/b", "a:b", "SERMONS"]) {
      nameIt(bad);
      cy.get("[data-testid=folder-name-error]").should("be.visible");
    }
    cy.get("[data-testid=folder-name-input]").clear();
    cy.get("[data-testid=folder-name-submit]").click();
    cy.get("[data-testid=folder-name-error]").should("be.visible");
    cy.task("file:exists", vaultDir("Notes/.hidden")).should("equal", false);
    cy.task("file:exists", vaultDir("Notes/SERMONS")).then((exists) => {
      // On a case-insensitive disk `SERMONS` is `Sermons`, which is there.
      if (exists) cy.task("file:exists", vaultDir("Notes/Sermons")).should("equal", true);
    });
  });

  it("deletes an empty Folder and refuses one that holds anything", () => {
    cy.task("dir:make", vaultDir("Notes/Tidy"));
    cy.task("file:write", { path: vaultDir("Notes/Tidy/.DS_Store"), text: "x" });
    cy.reload();
    cy.get(`${folder("Tidy")} > [data-testid=folder-menu]`).click();
    cy.get("[data-testid=folder-menu-delete]").click();
    cy.get(row("Tidy")).should("not.exist");
    cy.task("file:exists", vaultDir("Notes/Tidy")).should("equal", false);

    cy.get(`${folder("Sermons")} > [data-testid=folder-menu]`).click();
    cy.get("[data-testid=folder-menu-delete]").click();
    cy.contains("[data-sonner-toast]", "week 10.md").should("be.visible");
    cy.get(row("Sermons")).should("exist");
    cy.task("file:exists", vaultDir("Notes/Sermons/2026/week 2.md")).should("equal", true);
  });

  it("writes a new Note inside a Folder from its +, and at the top from New", () => {
    cy.get(row("Sermons")).click();
    cy.get(`${folder("Sermons/2026")} > [data-testid=folder-new-here]`).click();
    cy.get("[data-testid=new-doc-folder]").should("contain", "2026");
    cy.get("[data-testid=new-doc-form] [data-testid=new-doc-title]").type("Week 11");
    cy.get("[data-testid=submit-doc]").click();
    cy.get("[data-testid=doc-title]").should("have.value", "Week 11");
    cy.docByTitle("Week 11").its("path").should("equal", "Notes/Sermons/2026/week 11.md");

    cy.get("[data-testid=sidebar-new]").click();
    cy.get("[data-testid=new-doc-folder]").should("not.exist");
    cy.get("[data-testid=new-doc-form] [data-testid=new-doc-title]").type("Loose thought");
    cy.get("[data-testid=submit-doc]").click();
    cy.docByTitle("Loose thought").its("path").should("equal", "Notes/loose thought.md");
  });
});

describe("Moving documents into Folders", () => {
  beforeEach(() => cy.openApp());
  const vaultFile = (rel: string) => `${Cypress.env("vault")}/${rel}`;
  const docRow = (title: string) => cy.contains("[data-testid=folder-tree-note] [data-testid=doc-row]", title);

  it("moves a Note into a Folder from its … menu", () => {
    docRow("Reading plan").find("[data-testid=doc-menu]").click();
    cy.get("[data-testid=doc-menu-move]").click();
    cy.get("[data-testid=folder-picker] [data-testid=folder-pick][data-folder='Sermons/2026']").click();
    cy.get("[data-testid=folder-picker]").should("not.exist");
    cy.docByTitle("Reading plan").its("path").should("equal", "Notes/Sermons/2026/reading plan.md");
    cy.task("file:exists", vaultFile("Notes/reading plan.md")).should("equal", false);
  });

  it("moves the open Note with the Move to folder… Command", () => {
    cy.openDoc("Reading plan");
    cy.palette(">Move to folder");
    cy.get("[data-testid=palette] [cmdk-item]").contains("Move to folder").click();
    cy.get("[data-testid=folder-pick][data-folder='Sermons']").click();
    cy.docByTitle("Reading plan").its("path").should("equal", "Notes/Sermons/reading plan.md");
  });

  it("refuses a Folder that already holds a file of that name, adding no number", () => {
    cy.task("file:write", { path: vaultFile("Notes/Sermons/READING PLAN.md"), text: "Another plan.\n" });
    cy.reload();
    docRow("Reading plan").find("[data-testid=doc-menu]").click();
    cy.get("[data-testid=doc-menu-move]").click();
    cy.get("[data-testid=folder-pick][data-folder='Sermons']").click();
    cy.contains("[data-sonner-toast]", "READING PLAN.md").should("be.visible");
    cy.docByTitle("Reading plan").its("path").should("equal", "Notes/reading plan.md");
    cy.task("file:exists", vaultFile("Notes/Sermons/reading plan 2.md")).should("equal", false);
  });

  it("moves a Note by dragging it onto a Folder, and only its own group lights up", () => {
    const data = new DataTransfer();
    docRow("Reading plan").trigger("dragstart", { dataTransfer: data });
    cy.get('[data-testid=folder-tree-note] [data-folder="Sermons"]').trigger("dragover", { dataTransfer: data });
    cy.get('[data-testid=folder-tree-note] [data-folder="Sermons"]').should("have.attr", "data-drop-target", "true");
    // The Compositions group is no target for a Note.
    cy.get("[data-testid=folder-tree-composition]").trigger("dragover", { dataTransfer: data });
    cy.get("[data-testid=folder-tree-composition]").should("not.have.attr", "data-drop-target");
    // Dropped on Compositions, nothing happens: it is no target.
    cy.get("[data-testid=folder-tree-composition]").trigger("drop", { dataTransfer: data });
    cy.docByTitle("Reading plan").its("path").should("equal", "Notes/reading plan.md");
    cy.get('[data-testid=folder-tree-note] [data-folder="Sermons"]').trigger("drop", { dataTransfer: data });
    cy.docByTitle("Reading plan").its("path").should("equal", "Notes/Sermons/reading plan.md");
  });

  it("moves a Note back to the top by dropping it on its group", () => {
    cy.get('[data-testid=folder-tree-note] [data-folder="Sermons"] > [data-testid=folder-row]').click();
    cy.get('[data-testid=folder-tree-note] [data-folder="Sermons/2026"] > [data-testid=folder-row]').click();
    const data = new DataTransfer();
    docRow("Week 2").trigger("dragstart", { dataTransfer: data });
    cy.get("[data-testid=folder-tree-note]").trigger("dragover", { dataTransfer: data });
    cy.get("[data-testid=folder-tree-note]").should("have.attr", "data-drop-target", "true");
    cy.get("[data-testid=folder-tree-note]").trigger("drop", { dataTransfer: data });
    cy.docByTitle("Week 2").its("path").should("equal", "Notes/week 2.md");
  });

  it("moves a Composition with its Board", () => {
    cy.task("dir:make", vaultFile("Compositions/Talks"));
    cy.reload();
    cy.contains("[data-testid=folder-tree-composition] [data-testid=doc-row]", "Talk on endurance").find("[data-testid=doc-menu]").click();
    cy.get("[data-testid=doc-menu-move]").click();
    cy.get("[data-testid=folder-pick][data-folder='Talks']").click();
    cy.docByTitle("Talk on endurance").its("path").should("equal", "Compositions/Talks/talk on endurance.md");
    // Its Board went with it.
    cy.task("file:exists", vaultFile("Compositions/Talks/talk on endurance.canvas")).should("equal", true);
    cy.task("file:exists", vaultFile("Compositions/talk on endurance.canvas")).should("equal", false);
  });
});

describe("Renaming and moving Folders", () => {
  beforeEach(() => cy.openApp());
  const vaultDir = (rel: string) => `${Cypress.env("vault")}/${rel}`;
  const nameIt = (name: string) => {
    cy.get("[data-testid=folder-name-input]").clear().type(name);
    cy.get("[data-testid=folder-name-submit]").click();
  };

  it("renames a Folder, keeping its documents and their titles", () => {
    cy.get(`${folder("Sermons")} > [data-testid=folder-menu]`).click();
    cy.get("[data-testid=folder-menu-rename]").click();
    cy.get("[data-testid=folder-name-input]").should("have.value", "Sermons").and("have.focus");
    nameIt("Talks given");
    cy.get(row("Talks given")).should("exist");
    // The row that opened the dialog was replaced; focus goes to the renamed one.
    cy.get(row("Talks given")).should("have.focus");
    cy.get(row("Sermons")).should("not.exist");
    cy.docByTitle("Week 2").its("path").should("equal", "Notes/Talks given/2026/week 2.md");
    cy.task("file:exists", vaultDir("Notes/Sermons")).should("equal", false);
  });

  it("refuses renaming a Folder onto a sibling's name", () => {
    cy.task("dir:make", vaultDir("Notes/Archive"));
    cy.reload();
    cy.get(`${folder("Sermons")} > [data-testid=folder-menu]`).click();
    cy.get("[data-testid=folder-menu-rename]").click();
    nameIt("ARCHIVE");
    cy.get("[data-testid=folder-name-error]").should("be.visible");
    cy.task("file:exists", vaultDir("Notes/Sermons/2026/week 2.md")).should("equal", true);
  });

  it("moves a Folder from its menu, never into itself", () => {
    cy.task("dir:make", vaultDir("Notes/Archive"));
    cy.reload();
    cy.get(`${folder("Sermons")} > [data-testid=folder-menu]`).click();
    cy.get("[data-testid=folder-menu-move]").click();
    cy.get("[data-testid=folder-picker-find]").should("have.focus");
    // Neither the Folder nor its own Folders are offered.
    cy.get("[data-testid=folder-pick][data-folder='Sermons']").should("not.exist");
    cy.get("[data-testid=folder-pick][data-folder='Sermons/2026']").should("not.exist");
    cy.get("[data-testid=folder-pick][data-folder='Archive']").click();
    cy.docByTitle("Week 10").its("path").should("equal", "Notes/Archive/Sermons/2026/week 10.md");
    // Archive is folded, so focus goes to it rather than to the page.
    cy.get(row("Archive")).should("have.focus");
  });

  it("moves a Folder by dragging it onto another, and back onto the group", () => {
    cy.task("dir:make", vaultDir("Notes/Archive"));
    cy.reload();
    const data = new DataTransfer();
    cy.get(folder("Sermons")).trigger("dragstart", { dataTransfer: data });
    // Not onto itself.
    cy.get(folder("Sermons")).trigger("dragover", { dataTransfer: data });
    cy.get(folder("Sermons")).should("not.have.attr", "data-drop-target");
    cy.get(folder("Archive")).trigger("dragover", { dataTransfer: data });
    cy.get(folder("Archive")).should("have.attr", "data-drop-target", "true");
    cy.get(folder("Archive")).trigger("drop", { dataTransfer: data });
    cy.docByTitle("Week 2").its("path").should("equal", "Notes/Archive/Sermons/2026/week 2.md");

    cy.get(row("Archive")).click();
    const back = new DataTransfer();
    cy.get(folder("Archive/Sermons")).trigger("dragstart", { dataTransfer: back });
    cy.get("[data-testid=folder-tree-note]").trigger("dragover", { dataTransfer: back });
    cy.get("[data-testid=folder-tree-note]").trigger("drop", { dataTransfer: back });
    cy.docByTitle("Week 2").its("path").should("equal", "Notes/Sermons/2026/week 2.md");
  });

  it("keeps a Composition's Board beside it when its Folder moves", () => {
    cy.task("dir:make", vaultDir("Compositions/Talks"));
    cy.task("dir:make", vaultDir("Compositions/Given"));
    cy.reload();
    cy.contains("[data-testid=folder-tree-composition] [data-testid=doc-row]", "Talk on endurance").find("[data-testid=doc-menu]").click();
    cy.get("[data-testid=doc-menu-move]").click();
    cy.get("[data-testid=folder-pick][data-folder='Talks']").click();
    cy.get('[data-testid=folder-tree-composition] [data-folder="Talks"] > [data-testid=folder-menu]').click();
    cy.get("[data-testid=folder-menu-move]").click();
    cy.get("[data-testid=folder-pick][data-folder='Given']").click();
    cy.docByTitle("Talk on endurance").its("path").should("equal", "Compositions/Given/Talks/talk on endurance.md");
    cy.task("file:exists", vaultDir("Compositions/Given/Talks/talk on endurance.canvas")).should("equal", true);
  });
});
