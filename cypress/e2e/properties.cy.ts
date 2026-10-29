// Typed Properties (ADR 0006): one type per name, vault-wide, widgets by type,
// new names declared with a type the first time they are used.

// "Add Date" in a Hub's Dates area: the kind's Span pair, its missing half, or
// a Date the user names (CONTEXT.md, Span).
describe("Add Date", () => {
  beforeEach(() => cy.openApp());

  /** The selector of a document's own Lane, with the Timeline searched for it. */
  const timelineLane = (title: string) => {
    cy.runCommand("Timeline");
    cy.get("[data-testid=tl-search]").clear().type(title);
    return cy.docByTitle(title).then((d) => `[data-testid=tl-lane][data-lane=${d.id}]`);
  };

  it("adds a lifespan on a Character and draws it on the Timeline", () => {
    cy.bridge("create_document", { docType: "character", title: "Othniel", fields: {} });
    cy.openApp();
    cy.openDoc("Othniel");
    cy.get("[data-testid=hub-dates] [data-testid=add-date]").click();
    cy.get("[data-testid=add-date-pair]").should("contain", "Add lifespan").click();
    // Focus moves straight into the new field.
    cy.focused().should("have.attr", "data-testid", "date-input-born").type("c. 1450 BCE").blur();
    cy.get("[data-testid=date-born]").should("have.attr", "data-valid", "true");
    // Both halves are there, added or filled: the pair is no longer offered.
    cy.get("[data-testid=add-date]").click();
    cy.get("[data-testid=add-date-pair]").should("not.exist");
    cy.get("[data-testid=add-date-half]").should("not.exist");
    cy.get("body").type("{esc}");
    // Radix keeps pointer events off for a moment after a menu closes.
    cy.wait(500);
    cy.get("[data-testid=date-input-died]").type("c. 1370 BCE").blur();
    cy.get("[data-testid=date-died]").should("have.attr", "data-valid", "true");
    timelineLane("Othniel").then((lane) => {
      cy.get(`${lane} [data-testid=tl-mark] rect`).should("exist");
    });
  });

  it("offers only the missing half of a pair already half there", () => {
    cy.bridge("create_document", {
      docType: "event",
      title: "Siege of Jericho",
      fields: { start: "c. 1473 BCE" },
    });
    cy.openApp();
    cy.openDoc("Siege of Jericho");
    cy.get("[data-testid=hub-dates] [data-testid=add-date]").click();
    cy.get("[data-testid=add-date-pair]").should("not.exist");
    cy.get("[data-testid=add-date-half]").should("have.attr", "data-name", "end").click();
    cy.focused().should("have.attr", "data-testid", "date-input-end");
  });

  it("adds a Span on a Place and shows it on the Timeline, running on with start only", () => {
    cy.bridge("create_document", { docType: "place", title: "Nineveh", fields: {} });
    cy.openApp();
    cy.openDoc("Nineveh");
    cy.get("[data-testid=hub-dates] [data-testid=add-date]").click();
    cy.get("[data-testid=add-date-pair]").should("contain", "Add Span").click();
    cy.focused().should("have.attr", "data-testid", "date-input-start").type("c. 2000 BCE").blur();
    cy.get("[data-testid=date-start]").should("have.attr", "data-valid", "true");
    // Start alone: the city still stands, drawn running on.
    cy.get("[data-testid=hub-minitimeline] [data-testid=mini-mark][data-runs-on=true]").should("exist");
    timelineLane("Nineveh").then((lane) => {
      cy.get(`${lane} [data-testid=tl-mark][data-runs-on=true] rect`).should("exist");
    });
    cy.openDoc("Nineveh");
    // A page opened afresh shows only what it has, and offers the other half.
    cy.get("[data-testid=date-input-end]").should("not.exist");
    cy.get("[data-testid=add-date]").click();
    cy.get("[data-testid=add-date-half]").should("have.attr", "data-name", "end").click();
    cy.focused().type("612 BCE").blur();
    cy.get("[data-testid=date-end]").should("have.attr", "data-valid", "true");
    timelineLane("Nineveh").then((lane) => {
      cy.get(`${lane} [data-testid=tl-mark] rect`).should("exist");
      cy.get(`${lane} [data-testid=tl-mark][data-runs-on=true]`).should("not.exist");
    });
  });

  it("names a Date, and refuses a name the vault types otherwise", () => {
    cy.openDoc("Ephesus");
    cy.get("[data-testid=hub-dates] [data-testid=add-date]").click();
    cy.get("[data-testid=add-date-named]").click();
    cy.focused().should("have.attr", "data-testid", "date-name-input");
    cy.get("[data-testid=date-name-input]").type("modern_name{enter}");
    cy.get("[data-testid=date-name-error]").should("contain", "modern_name");
    cy.get("[data-testid=date-name-input]").clear().type("destroyed_by_goths{enter}");
    cy.get("[data-testid=date-name-form]").should("not.exist");
    cy.focused()
      .should("have.attr", "data-testid", "date-input-destroyed_by_goths")
      .type("262 CE")
      .blur();
    cy.get("[data-testid=date-destroyed_by_goths]").should("have.attr", "data-valid", "true");
    cy.bridge<{ types: Record<string, string> }>("property_schema").then((s) => {
      expect(s.types.destroyed_by_goths).to.equal("date");
    });
  });
});

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
