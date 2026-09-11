// Typed Properties (ADR 0006): one type per name, vault-wide, widgets by type,
// new names declared with a type the first time they are used.
describe("Properties", () => {
  beforeEach(() => cy.openApp());

  it("built-in names get their widget: lat is a number, source a link", () => {
    cy.openDoc("Ephesus");
    cy.get("[data-testid=property-lat]").should(
      "have.attr",
      "data-prop-type",
      "number",
    );
    cy.get("[data-testid=property-lat] input").should(
      "have.attr",
      "type",
      "number",
    );
    cy.get("[data-testid=property-modern_name]").should(
      "have.attr",
      "data-prop-type",
      "text",
    );
    cy.openDoc("Endurance in trials");
    cy.get("[data-testid=property-source]").should(
      "have.attr",
      "data-prop-type",
      "link",
    );
    cy.get("[data-testid=property-source] button[aria-label=Open]").should(
      "exist",
    );
  });

  it("a new name asks for a type, which is saved vault-wide and persists", () => {
    cy.openDoc("Ephesus");
    cy.get("[data-testid=add-property] input").type("founded");
    cy.get(
      "[data-testid=add-property] button[aria-label='Property type']",
    ).click();
    cy.get("[role=option]").contains("Date (Bible)").click();
    cy.get("[data-testid=add-property] input").type("{enter}");
    cy.get("[data-testid=property-founded]").should(
      "have.attr",
      "data-prop-type",
      "date",
    );
    cy.get("[data-testid=property-founded] input").should(
      "have.attr",
      "placeholder",
      "c. 1513 BCE",
    );
    // Declared once: the schema file records it and another page knows the name.
    cy.task<string>(
      "file:read",
      `${Cypress.env("vault")}/.bible-study/properties.json`,
    ).then((text) => {
      expect(JSON.parse(text).types.founded).to.equal("date");
    });
    cy.openDoc("Corinth");
    cy.get("[data-testid=add-property] input").type("founded");
    cy.get("[data-testid=add-property]").should("contain", "Date (Bible)");
  });

  it("number values are written bare and a name can be retyped from its label", () => {
    cy.openDoc("Ephesus");
    cy.get("[data-testid=property-lat] input").clear().type("38.5").blur();
    cy.wait(800);
    cy.docByTitle("Ephesus").then((d) => {
      cy.task<string>("file:read", `${Cypress.env("vault")}/${d.path}`).then(
        (text) => {
          expect(text).to.contain("lat: 38.5\n");
        },
      );
    });
    cy.get(
      "[data-testid=property-modern_name] button[aria-label='modern_name: Property type']",
    ).click();
    cy.get("[role=menuitemradio]").contains("Link").click();
    cy.get("[data-testid=property-modern_name]").should(
      "have.attr",
      "data-prop-type",
      "link",
    );
    // Radix keeps pointer events off for a moment after a menu closes.
    cy.wait(500);
    cy.get(
      "[data-testid=property-modern_name] button[aria-label='modern_name: Property type']",
    ).click();
    cy.get("[role=menuitemradio]").contains("Text").click();
    cy.get("[data-testid=property-modern_name]").should(
      "have.attr",
      "data-prop-type",
      "text",
    );
  });
});
