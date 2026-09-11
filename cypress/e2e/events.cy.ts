// Events (a Topical Subject) and Dates (ADR 0005) on Hub pages.
describe("Events and Dates", () => {
  beforeEach(() => cy.openApp());

  it("Event hub: dates as written, Place and Characters as link properties", () => {
    cy.openDoc("Paul in Ephesus");
    cy.get("[data-testid=right-panel]").should("not.exist");
    cy.get("[data-testid=hub-header]").should("contain", "Event");
    cy.get("[data-testid=hub-dates] [data-testid=date-start]")
      .should("have.attr", "data-valid", "true")
      .and("contain", "c. 52 CE");
    cy.get("[data-testid=hub-dates] [data-testid=date-end]").should(
      "contain",
      "c. 55 CE",
    );
    cy.get("[data-testid=property-place]").should(
      "have.attr",
      "data-prop-type",
      "link",
    );
    cy.get("[data-testid=property-place] input").should(
      "have.value",
      "[[Ephesus]]",
    );
    cy.get("[data-testid=property-characters]").should(
      "have.attr",
      "data-prop-type",
      "list",
    );
    // Ac 19:8-10 in the body is a Mention like anywhere else.
    cy.get("[data-testid=hub-about]").should("contain", "Tyrannus");
  });

  it("Character hub: open-ended Date properties and the Events naming it", () => {
    cy.openDoc("David");
    cy.get("[data-testid=hub-dates] [data-testid=date-born]").should(
      "contain",
      "c. 1107 BCE",
    );
    // "anointed" is a user-declared Date in .bible-study/properties.json.
    cy.get("[data-testid=hub-dates] [data-testid=date-anointed]").should(
      "have.attr",
      "data-valid",
      "true",
    );
    cy.get("[data-testid=hub-dates] [data-testid=date-died]").should(
      "contain",
      "1037 BCE",
    );
    cy.get("[data-testid=hub-events]").should("contain", "David anointed king");
    cy.openDoc("Bethlehem");
    cy.get("[data-testid=hub-events]").should("contain", "David anointed king");
  });

  it("a Date the app cannot read is kept, flagged, and off the Timeline", () => {
    cy.openDoc("The Flood");
    cy.get("[data-testid=property-end] input").type("whenever").blur();
    cy.get("[data-testid=hub-dates] [data-testid=date-end]")
      .should("have.attr", "data-valid", "false")
      .and("contain", "whenever");
    cy.get("[data-testid=hub-dates] [data-testid=date-start]").should(
      "have.attr",
      "data-valid",
      "true",
    );
    cy.docByTitle("The Flood").then((d) => {
      cy.bridge<{ doc: { id: string }; name: string }[]>("timeline").then(
        (rows) => {
          const mine = rows.filter((r) => r.doc.id === d.id).map((r) => r.name);
          expect(mine).to.deep.equal(["start"]);
        },
      );
    });
  });

  it("New Event lands in Events/ with its template", () => {
    cy.runCommand("New Event");
    cy.get("[data-testid=new-doc-form]").should("contain", "Event");
    cy.get("[data-testid=new-doc-form] input").first().type("Pentecost 33");
    cy.get("[data-testid=new-doc-form] input[placeholder='c. 1513 BCE']")
      .first()
      .type("Sivan 33 CE");
    cy.get("[data-testid=new-doc-form]").contains("button", "Create").click();
    cy.get("[data-testid=hub-header]").should("contain", "Event");
    cy.get("[data-testid=hub-dates] [data-testid=date-start]").should(
      "contain",
      "Sivan 33 CE",
    );
    cy.docByTitle("Pentecost 33").then((d) => {
      expect(d.path).to.match(/^Events\//);
    });
    cy.get("[data-sidebar=content]").should("contain", "Events");
  });
});
