describe("Dialogs", () => {
  beforeEach(() => cy.openApp());

  it("creates and deletes a Note", () => {
    cy.get("[data-testid=sidebar-new]").click();
    cy.get("[data-testid=new-doc-title]").type("Cypress note");
    cy.get("[data-testid=new-doc-form]").contains("button", "Create").click();
    cy.get("input[aria-label=Title]").should("have.value", "Cypress note");
    cy.docByTitle("Cypress note")
      .its("path")
      .should("equal", "Notes/cypress note.md");
    cy.get("button[aria-label=Delete]").click();
    cy.get("[data-testid=confirm-delete]").click();
    cy.get("h1").should("contain", "Home");
    cy.bridge<{ title: string }[]>("list_documents", { docType: "note" }).then(
      (notes) => {
        expect(notes.map((n) => n.title)).to.not.include("Cypress note");
      },
    );
  });

  it("creates a Place with coordinates and shows it on the map", () => {
    cy.get("body").type("{ctrl}n");
    cy.get("[data-testid=new-doc-form]").contains("button", "Place").click();
    cy.get("[data-testid=new-doc-title]").type("Antioch");
    cy.get("[data-testid=new-doc-form] input[placeholder='31.7683']").type(
      "36.2",
    );
    cy.get("[data-testid=new-doc-form] input[placeholder='35.2137']").type(
      "36.16",
    );
    cy.get("[data-testid=new-doc-form]").contains("button", "Create").click();
    cy.hubTitle("Antioch");
    cy.get("[data-testid=hub-map]").should("exist");
    cy.get("[data-testid=nav-map]").click();
    cy.get("[data-testid=map] .leaflet-tooltip").should("contain", "Antioch");
  });

  it("creates a Clipping with a new Source from the same dialog", () => {
    cy.runCommand("New Clipping");
    cy.get("[data-testid=new-doc-form] textarea").type(
      "A line worth keeping (Ps 119:105).",
    );
    cy.get(
      "[data-testid=new-doc-form] input[placeholder*='Existing Source']",
    ).type("Brand new source");
    cy.get("[data-testid=new-doc-form] input[placeholder^='par. 12']").type(
      "p. 3",
    );
    cy.get("[data-testid=new-doc-form]").contains("button", "Create").click();
    cy.get("input[aria-label=Title]")
      .invoke("val")
      .should("match", /^Brand new source – A line worth keeping/);
    cy.get(
      "[data-testid=right-panel] input[value='[[Brand new source]]']",
    ).should("exist");
    cy.get("[data-testid=right-panel] input[value='p. 3']").should("exist");
    cy.docByTitle("Brand new source").its("type").should("equal", "source");
  });

  it("creates a page for an unresolved link", () => {
    cy.get("[data-testid=group-unresolved]").click();
    cy.get("[data-testid=unresolved-item]").contains("Priscilla").click();
    cy.get("[data-testid=create-link]").should("exist");
    cy.get("[role=dialog]").contains("button", "Character").click();
    cy.get("[role=dialog]").contains("button", "Create").click();
    cy.hubTitle("Priscilla");
    cy.get("[data-testid=hub-header]").should("contain", "Character");
    cy.get("[data-testid=backlinks]").should("contain", "Paul in Ephesus");
  });

  it("quick capture dialog creates and opens a Note", () => {
    cy.get("body").type("{ctrl}{shift}n");
    cy.get("[role=dialog] textarea").type(
      "From the quick capture dialog{ctrl}{enter}",
    );
    cy.get(".cm-content").should("contain", "From the quick capture dialog");
  });

  it("changing the type property moves the document between groups", () => {
    cy.openDoc("2026-09-01 10.30");
    cy.get("[data-testid=right-panel] [data-slot=select-trigger]").click();
    cy.get("[role=option]").contains("Concept").click();
    cy.get("[data-testid=hub-header]").should("contain", "Concept");
    cy.docByTitle("2026-09-01 10.30").its("type").should("equal", "concept");
  });
});
