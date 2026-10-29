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

  it("a Property can be removed from its label menu, and leaves the file", () => {
    cy.openDoc("Ephesus");
    cy.get("[data-testid=property-modern_name]").should("exist");
    cy.get(
      "[data-testid=property-modern_name] button[aria-label='modern_name: Property type']",
    ).click();
    cy.get("[data-testid=remove-property-modern_name]").click();
    cy.get("[data-testid=property-modern_name]").should("not.exist");
    cy.wait(800);
    cy.docByTitle("Ephesus").then((d) => {
      cy.task<string>("file:read", `${Cypress.env("vault")}/${d.path}`).then(
        (text) => {
          expect(text).not.to.contain("modern_name:");
          // Only that line went: its neighbours are untouched (ADR 0003).
          expect(text).to.contain("lat:");
          expect(text).to.contain("lon:");
        },
      );
    });
  });
});

// The live Date preview (ADR 0005): under each Date field, how the engine reads
// the value as typed, or why it is not a Date. The text itself is never touched.
describe("Date preview", () => {
  beforeEach(() => cy.openApp());

  it("reads a value as you type, before it is saved", () => {
    cy.openDoc("David");
    cy.get("[data-testid=date-preview-born]")
      .should("have.attr", "data-ok", "true")
      .and("contain", "≈ 1107 BCE · year");
    cy.get("[data-testid=date-input-born]").clear().type("14 nisan 33 c.e.");
    cy.get("[data-testid=date-preview-born]")
      .should("have.attr", "data-ok", "true")
      .and("contain", "14 Nisan 33 CE · day");
    // As typed, not rewritten to the preview's spelling.
    cy.get("[data-testid=date-input-born]").should("have.value", "14 nisan 33 c.e.");
    cy.get("[data-testid=date-input-born]").clear().type("1107");
    cy.get("[data-testid=date-preview-born]")
      .should("have.attr", "data-error", "no_era")
      .and("contain", "BCE or CE");
    cy.get("[data-testid=date-input-born]").type("{esc}");
  });

  it("tells you to split a range typed in one value into the pair", () => {
    cy.openDoc("David");
    cy.get("[data-testid=date-input-born]").clear().type("1107–1037 BCE");
    cy.get("[data-testid=date-preview-born]")
      .should("have.attr", "data-ok", "false")
      .and("have.attr", "data-error", "looks_like_range")
      .and("contain", "Split it into the pair");
    cy.get("[data-testid=date-input-born]").should("have.value", "1107–1037 BCE");
    cy.get("[data-testid=date-input-born]").type("{esc}");
  });

  it("shows under a Date in the Properties panel too", () => {
    // `founded` is declared a Date here, so it is edited in the panel, not
    // in the Hub's Span.
    cy.openDoc("Ephesus");
    cy.get("[data-testid=add-property] input").type("founded");
    cy.get(
      "[data-testid=add-property] button[aria-label='Property type']",
    ).click();
    cy.get("[role=option]").contains("Date (Bible)").click();
    cy.get("[data-testid=add-property] input").type("{enter}");
    cy.get("[data-testid=property-founded] input").type("c. 1000 BCE");
    cy.get("[data-testid=date-preview-founded]").should(
      "contain",
      "≈ 1000 BCE · year",
    );
    cy.get("[data-testid=property-founded] input").clear().type("1000 to 900 BCE");
    cy.get("[data-testid=date-preview-founded]").should(
      "have.attr",
      "data-error",
      "looks_like_range",
    );
  });
});
