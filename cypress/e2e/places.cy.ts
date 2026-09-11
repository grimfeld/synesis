// Place lookup (PLAN §14.6): bundled gazetteer in the New Place dialog and a
// Set-location dialog on the Place hub (pick from the gazetteer or click the map).
describe("Places", () => {
  beforeEach(() => cy.openApp());

  it("New Place: picking a gazetteer hit fills title, coordinates and modern name", () => {
    cy.runCommand("New Place");
    cy.get("[data-testid=new-doc-form]").should("contain", "Place");
    cy.get("[data-testid=gazetteer] input").type("Eph");
    cy.get("[data-testid=gazetteer] button").contains("Ephesus").click();
    cy.get("[data-testid=new-doc-title]").should("have.value", "Ephesus");
    cy.get("[data-testid=new-doc-form] input[placeholder='31.7683']").should(
      "have.value",
      "37.9391",
    );
    cy.get("[data-testid=new-doc-form] input[placeholder='35.2137']").should(
      "have.value",
      "27.3407",
    );
    cy.get("[data-testid=new-doc-title]").clear().type("Ephesus (test)");
    cy.get("[data-testid=new-doc-form]").contains("button", "Create").click();
    cy.get("[data-testid=hub-header]").should("contain", "Place");
    cy.get("[data-testid=hub-map]").should("exist");
    cy.get("[data-testid=property-modern_name] input").should(
      "have.value",
      "Ephesus",
    );
  });

  it("Set location on a Place hub: gazetteer pick, then a click on the map", () => {
    cy.openDoc("Corinth");
    cy.get("[data-testid=property-lat] input").should("have.value", "37.9058");
    cy.get("button[aria-label='Set location']").click();
    cy.get("[data-testid=set-location]").should("be.visible");
    cy.get("[data-testid=gazetteer] input").type("Jerusalem");
    cy.get("[data-testid=gazetteer] button")
      .contains(/^Jerusalem$/)
      .click();
    cy.get("[data-testid=set-location-pos]").should(
      "contain",
      "31.7767, 35.2342",
    );
    cy.contains("button", "Use this location").click();
    cy.get("[data-testid=set-location]").should("not.exist");
    cy.get("[data-testid=property-lat] input").should("have.value", "31.7767");
    cy.get("[data-testid=property-lon] input").should("have.value", "35.2342");
    // Clicking the map moves the marker; the position changes.
    cy.get("button[aria-label='Set location']").click();
    cy.get("[data-testid=set-location-map]").click(80, 60);
    cy.get("[data-testid=set-location-pos]").should(
      "not.contain",
      "31.7767, 35.2342",
    );
    cy.contains("button", "Use this location").click();
    cy.get("[data-testid=property-lat] input").should(
      "not.have.value",
      "31.7767",
    );
  });
});
