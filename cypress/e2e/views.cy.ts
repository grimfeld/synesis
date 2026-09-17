describe("Views", () => {
  beforeEach(() => cy.openApp());

  it("Coverage shades mentioned chapters and opens a Chapter hub", () => {
    cy.get("[data-testid=nav-coverage]").click();
    cy.get("h1").should("contain", "Coverage");
    cy.get("[data-testid=coverage-cell]").should("have.length", 1189);
    cy.get("[data-testid=coverage-cell]:not([data-count='0'])").should(
      "have.length.greaterThan",
      15,
    );
    // Counts come from the engine, so the assertion follows the demo vault's content.
    cy.bridge<{ book: number; chapter: number; count: number }[]>("coverage").then((cells) => {
      const gen2 = cells.find((c) => c.book === 1 && c.chapter === 2);
      cy.get("[data-testid=coverage-cell][title^='Genesis 2 ']").should("have.attr", "data-count", String(gen2?.count ?? 0));
    });
    cy.get("[data-testid=coverage-cell][title^='Romans 8 ']").click();
    cy.get("[data-testid=hub-header]").should("contain", "Romans 8");
  });

  it("Graph renders nodes and filters by type", () => {
    cy.get("[data-testid=nav-graph]").click();
    cy.get("[data-testid=graph-canvas]").should("be.visible");
    cy.get("[data-testid=graph-counts]").should(($b) =>
      expect(parseInt($b.text(), 10)).to.be.greaterThan(20),
    );
    // How many Notes the demo vault holds is not this test's business: ask
    // the engine rather than hardcoding a number that every new demo document
    // invalidates.
    cy.query<{ type: string }[]>({ kind: "list", docType: null }).then((docs) => {
      const notes = docs.filter((d) => d.type === "note").length;
      cy.get("[data-testid=graph-counts]")
        .invoke("text")
        .then((text) => {
          const [nodes] = text.split("·").map((x) => parseInt(x.trim(), 10));
          cy.get("[data-slot=toggle-group-item]").contains("Notes").click();
          cy.get("[data-testid=graph-counts]")
            .invoke("text")
            .then((after) => {
              const [n2] = after.split("·").map((x) => parseInt(x.trim(), 10));
              expect(n2).to.equal(nodes - notes);
            });
        });
    });
  });

  it("Map shows every Place with coordinates", () => {
    cy.get("[data-testid=nav-map]").click();
    cy.query<unknown[]>({ kind: "places" }).then((places) => {
      cy.get("[data-testid=map] path.leaflet-interactive").should("have.length", places.length);
    });
    cy.get("[data-testid=map] .leaflet-tooltip")
      .should("contain", "Ephesus")
      .and("contain", "Corinth");
  });

  it("Settings switches the language and lists shortcuts", () => {
    cy.get("[data-testid=nav-settings]").click();
    cy.get("h1").should("contain", "Settings");
    cy.contains("Keyboard shortcuts")
      .parents("[data-slot=card]")
      .should("contain", "Search")
      .and("contain", "Quick capture");
    cy.get("[data-slot=select-trigger]").first().click();
    cy.get("[role=option]").contains("Français").click();
    cy.get("h1").should("contain", "Réglages");
    cy.get("[data-testid=nav-home]").should("contain", "Accueil");
    cy.get("[data-slot=select-trigger]").first().click();
    cy.get("[role=option]").contains("English").click();
    cy.get("h1").should("contain", "Settings");
  });
});
