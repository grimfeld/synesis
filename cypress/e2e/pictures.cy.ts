// Pictures (ADR 0018): dropped, pasted or picked into any editor, copied into
// `Attachments/` named after the document, written as `![[…]]` on their own
// line and drawn in Live Preview.
const vaultFile = (rel: string) => `${Cypress.env("vault")}/${rel}`;

/** The stored text of a document, once the save has landed. */
function fileOf(title: string) {
  return cy.docByTitle(title).then((d) => cy.task<string>("file:read", vaultFile(d.path)));
}

/** Paste a picture the way a screenshot arrives: a File and no text. */
function pastePicture(selector: string) {
  cy.fixture("athens.png", null).then((bytes: Uint8Array) => {
    cy.window().then((win) => {
      const dt = new win.DataTransfer();
      dt.items.add(new win.File([bytes], "image.png", { type: "image/png" }));
      cy.get(selector).then(($el) => {
        $el[0].dispatchEvent(new win.ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      });
    });
  });
}

describe("Pictures", () => {
  beforeEach(() => cy.openApp());

  it("drops a picture into a Note, named after it, on its own line", () => {
    cy.openDoc("Endurance in trials");
    cy.get(".cm-content").should("contain", "Endurance in trials");
    cy.get(".cm-content").selectFile("cypress/fixtures/athens.png", { action: "drag-drop" });
    cy.get("[data-testid=picture][data-state=shown] img").should("be.visible");
    cy.task<boolean>("file:exists", vaultFile("Attachments/endurance in trials.png")).should("eq", true);
    cy.wait(1000);
    fileOf("Endurance in trials").should("match", /(^|\n)!\[\[Attachments\/endurance in trials\.png\]\](\n|$)/);
  });

  it("shows the stored text on the line being edited, and only text in Source mode", () => {
    cy.openDoc("Endurance in trials");
    cy.get(".cm-content").selectFile("cypress/fixtures/athens.png", { action: "drag-drop" });
    cy.get("[data-testid=picture][data-state=shown]").should("exist");
    // The cursor sits after the inserted line: its syntax is visible, the picture below it.
    cy.get(".cm-content").should("contain", "![[Attachments/endurance in trials.png]]");
    // Elsewhere, the line is the picture.
    cy.get(".cm-line").first().click();
    cy.get(".cm-content").should("not.contain", "![[Attachments/endurance in trials.png]]");
    cy.get("[data-testid=picture] img").should("be.visible");
    cy.runCommand("Source mode");
    cy.get("[data-testid=picture]").should("not.exist");
    cy.get(".cm-content").should("contain", "![[Attachments/endurance in trials.png]]");
    cy.runCommand("Live Preview");
  });

  it("is not a link, a Tag or a Passage", () => {
    cy.openDoc("Endurance in trials");
    cy.get(".cm-content").selectFile("cypress/fixtures/athens.png", { action: "drag-drop" });
    cy.get("[data-testid=picture][data-state=shown]").should("exist");
    cy.get(".cm-wikilink-unresolved").should("not.exist");
    cy.get(".cm-embed-box").should("not.exist");
  });

  it("pastes a screenshot at the cursor", () => {
    cy.openDoc("Endurance in trials");
    cy.get(".cm-content").should("contain", "Endurance in trials").click();
    pastePicture(".cm-content");
    cy.get("[data-testid=picture][data-state=shown]").should("exist");
    cy.task<boolean>("file:exists", vaultFile("Attachments/endurance in trials.png")).should("eq", true);
  });

  it("refuses a file that is not a picture", () => {
    cy.openDoc("Endurance in trials");
    cy.get(".cm-content").should("contain", "Endurance in trials");
    cy.get(".cm-content").selectFile("cypress/fixtures/notes.pdf", { action: "drag-drop" });
    cy.get("[data-sonner-toast]").should("contain", "Only pictures");
    cy.get(".cm-content").should("not.contain", "![[");
    cy.task<boolean>("file:exists", vaultFile("Attachments/endurance in trials.pdf")).should("eq", false);
  });

  it("inserts a picked picture with Insert picture", () => {
    cy.openDoc("Endurance in trials");
    cy.get(".cm-content").should("contain", "Endurance in trials").click();
    cy.runCommand("Insert picture");
    cy.get("[data-testid=picture-input]").selectFile("cypress/fixtures/athens.png", { force: true });
    cy.get("[data-testid=picture][data-state=shown]").should("exist");
  });

  it("says a missing picture is missing", () => {
    cy.docByTitle("Endurance in trials").then((d) => {
      cy.task<string>("file:read", vaultFile(d.path)).then((text) => {
        cy.task("file:write", { path: vaultFile(d.path), text: text + "\n![[Attachments/nowhere.png]]\n" });
      });
    });
    cy.openDoc("Endurance in trials");
    cy.get("[data-testid=picture][data-state=missing]").should("contain", "Picture not found").and("contain", "nowhere.png");
  });

  it("reads the short name Obsidian writes", () => {
    // Found in `Attachments/` by name alone; only being found is checked here.
    cy.task("file:write", { path: vaultFile("Attachments/paul.png"), text: "" });
    cy.docByTitle("Endurance in trials").then((d) => {
      cy.task<string>("file:read", vaultFile(d.path)).then((text) => {
        cy.task("file:write", { path: vaultFile(d.path), text: text + "\n![[paul.png|200]]\n" });
      });
    });
    cy.openDoc("Endurance in trials");
    cy.get("[data-testid=picture][data-picture='paul.png']").should("have.attr", "data-state", "shown");
  });

  it("drops a picture on an empty About, which opens with it", () => {
    cy.openDoc("Jerusalem");
    cy.hubTitle("Jerusalem");
    cy.get("[data-testid=hub-about-empty]").selectFile("cypress/fixtures/athens.png", { action: "drag-drop" });
    cy.get("[data-testid=hub-about] [data-testid=picture]").should("exist");
    cy.task<boolean>("file:exists", vaultFile("Attachments/jerusalem.png")).should("eq", true);
    cy.wait(1000);
    fileOf("Jerusalem").should("contain", "![[Attachments/jerusalem.png]]");
  });

  it("drops into an About that already has text", () => {
    // Not Jerusalem: the vault is seeded once per spec, and its About now holds a picture.
    cy.openDoc("Timothy");
    cy.get("[data-testid=hub-about-empty]").click();
    cy.get("[data-testid=hub-about] .cm-content").type("The city of the great King.");
    cy.get("[data-testid=hub-about] .cm-content").selectFile("cypress/fixtures/athens.png", { action: "drag-drop" });
    cy.get("[data-testid=hub-about] [data-testid=picture][data-state=shown]").should("exist");
  });
});
