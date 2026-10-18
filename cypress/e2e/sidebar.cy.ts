describe("Sidebar", () => {
  beforeEach(() => cy.openApp());

  it("groups documents by type with counts", () => {
    cy.get("[data-testid=group-note]")
      .should("contain", "Notes")
      .and("contain", "9");
    // A Clipping belongs to its Source, not to a folder of its own, so it has
    // no group here (ADR 0013).
    cy.get("[data-testid=group-clipping]").should("not.exist");
    // Counted from the engine, so a document added to the demo vault does
    // not read as a broken sidebar.
    cy.query<{ type: string }[]>({ kind: "list", docType: null }).then((docs) => {
      for (const type of ["source", "place", "character", "event"]) {
        const n = docs.filter((d) => d.type === type).length;
        expect(n, `${type}s in the demo vault`).to.be.greaterThan(0);
        cy.get(`[data-testid=group-${type}]`).should("contain", String(n));
      }
    });
  });

  it("expands a group and opens a document", () => {
    cy.get("[data-testid=group-source]").click();
    // Sources stand in Shelf folders, each part under its parent (PLAN §28.5).
    cy.get("[data-testid=source-folder][data-shelf=periodical]").click();
    cy.contains("[data-testid=doc-item]", /^The Watchtower$/)
      .parent()
      .find("[data-testid=source-node-toggle]")
      .click();
    cy.get("[data-testid=doc-item]").contains("The Watchtower 2024-03").click();
    cy.hubTitle("The Watchtower 2024-03");
    cy.get("[data-testid=doc-item][data-active=true]").should(
      "contain",
      "The Watchtower 2024-03",
    );
  });

  it("lists Scripture pages materialised from mentions", () => {
    cy.get("[data-testid=group-scripture]").click();
    cy.get("[data-testid=scripture-book]").should("have.length.greaterThan", 5);
    cy.get("[data-testid=scripture-book]").contains("Romans").click();
    cy.contains("Romans 8").should("be.visible");
  });

  it("lists unresolved links", () => {
    cy.get("[data-testid=group-unresolved]").click();
    cy.get("[data-testid=unresolved-item]").should("contain", "Priscilla");
  });

  it("Tags tab lists tags and their documents", () => {
    cy.get("[role=tab]").contains("Tags").click();
    cy.get("[data-testid=tag-item]").should("have.length.greaterThan", 4);
    cy.get("[data-testid=tag-item]").contains("endurance").click();
    cy.get("[data-testid=tag-doc]")
      .should("contain", "Endurance in trials")
      .and("contain", "Talk on endurance");
    cy.get("[data-testid=tag-doc]").contains("Talk on endurance").click();
    cy.get("[data-testid=doc-title]").should("have.value", "Talk on endurance");
  });

  it("navigates to views and toggles with the keyboard", () => {
    cy.get("[data-testid=nav-coverage]").click();
    cy.get("h1").should("contain", "Coverage");
    cy.get("[data-testid=nav-home]").click();
    cy.get("h1").should("contain", "Home");
    cy.get("body").type("{ctrl}b");
    cy.get("[data-sidebar=sidebar]").should("not.be.visible");
    cy.get("body").type("{ctrl}b");
    cy.get("[data-sidebar=sidebar]").should("be.visible");
  });
});
