// Mobile layout: the sidebar is a sheet over the page. It must close once a pick
// changed the view, and it must stay above the map (Leaflet's panes use z-index 400+).
describe("Mobile sidebar", () => {
  beforeEach(() => {
    cy.viewport(390, 844);
    cy.openApp();
  });

  const openSheet = () => {
    cy.get("[data-sidebar=trigger]").first().click();
    cy.get("[data-sidebar=sidebar][data-mobile=true]").should("be.visible");
  };

  it("closes after navigating to a view or a document", () => {
    openSheet();
    cy.get("[data-testid=nav-coverage]").click();
    cy.get("h1").should("contain", "Coverage");
    cy.get("[data-sidebar=sidebar][data-mobile=true]").should("not.exist");

    openSheet();
    cy.get("[data-testid=group-source]").click();
    cy.get("[data-testid=doc-item]").contains("The Watchtower 2024-03").click();
    cy.hubTitle("The Watchtower 2024-03");
    cy.get("[data-sidebar=sidebar][data-mobile=true]").should("not.exist");
  });

  it("stays above the map so pages can still be switched", () => {
    openSheet();
    cy.get("[data-testid=nav-map]").click();
    cy.get("[data-testid=map] .leaflet-pane").should("exist");
    cy.get("[data-sidebar=sidebar][data-mobile=true]").should("not.exist");

    openSheet();
    // Leaflet tiles have pointer-events: none, so hit-testing over the sheet falls
    // through them even when they are painted on top. The zoom control keeps
    // pointer-events and sits at z-index 1000 under the sheet's area, so the element
    // at its centre tells which of the two is painted above the other.
    cy.get(".leaflet-control-zoom-in").then(($zoom) => {
      const doc = $zoom[0].ownerDocument;
      const r = $zoom[0].getBoundingClientRect();
      const hit = doc.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      expect(hit?.closest("[data-mobile=true]"), "sheet above the map").to.exist;
    });
    cy.get("[data-testid=nav-home]").click();
    cy.get("h1").should("contain", "Home");
    cy.get("[data-testid=map]").should("not.exist");
  });
});
