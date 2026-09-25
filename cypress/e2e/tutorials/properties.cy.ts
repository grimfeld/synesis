// Walks the Properties & Dates Tutorial (docs/tutorials/properties.en.md)
// step by step, doing what each step says, so a change to typed Properties,
// Dates or the Timeline that outdates the Tutorial fails here (PLAN §24.13).
describe("Tutorial: Properties & Dates", () => {
  beforeEach(() => cy.openApp());

  it("can be followed to the end", () => {
    // A Place's page lists this Tutorial.
    cy.openDoc("Ephesus");
    cy.hubTitle("Ephesus");
    cy.openTutorial("properties");

    // 1. Properties in the header card, each with a widget for its type.
    cy.tutorialStep(0);
    cy.get("[data-testid=hub-header] [data-testid=property-lat]").should("have.attr", "data-prop-type", "number");
    cy.get("[data-testid=property-lat] input").should("have.attr", "type", "number");
    cy.get("[data-testid=property-modern_name]").should("have.attr", "data-prop-type", "text");
    cy.tutorialNext();

    // 2. A new name asks for a type once; the Vault then knows it.
    cy.tutorialStep(1);
    cy.get("[data-testid=add-property] input").type("founded");
    cy.get("[data-testid=add-property] button[aria-label='Property type']").click();
    cy.get("[role=option]").contains("Date (Bible)").click();
    cy.get("[data-testid=add-property] input").type("{enter}");
    cy.get("[data-testid=property-founded]").should("have.attr", "data-prop-type", "date");
    cy.openDoc("Corinth");
    cy.hubTitle("Corinth");
    cy.get("[data-testid=add-property] input").type("founded");
    cy.get("[data-testid=add-property]").should("contain", "Date (Bible)");
    cy.get("[data-testid=add-property] input").clear();
    // The label opens the menu that retypes or removes a Property.
    cy.get("[data-testid=property-modern_name] button[aria-label='modern_name: Property type']").click();
    cy.get("[data-testid=remove-property-modern_name]").should("contain", "Remove property");
    cy.get("body").type("{esc}");
    cy.get("[data-testid=remove-property-modern_name]").should("not.exist");
    // Radix keeps pointer events off for a moment after a menu closes.
    cy.wait(500);
    cy.tutorialNext();

    // 3. A Date written as a reader says it is read, kept as typed, and shown under Dates.
    cy.tutorialStep(2);
    cy.openDoc("Ephesus");
    cy.hubTitle("Ephesus");
    cy.get("[data-testid=property-founded] input").should("have.attr", "placeholder", "c. 1513 BCE").type("c. 1050 BCE").blur();
    cy.get("[data-testid=hub-dates] [data-testid=date-founded]", { timeout: 10000 })
      .should("have.attr", "data-valid", "true")
      .and("contain", "c. 1050 BCE");
    cy.tutorialNext();

    // 4. Do it once: a Character with Born and Died makes a Span on the Timeline.
    cy.tutorialStep(3);
    cy.tutorialCommand("create.character");
    cy.get("[data-testid=new-doc-form]").should("contain", "Character");
    cy.get("[data-testid=new-doc-title]").type("Caleb");
    cy.get("[data-testid=new-born]").type("c. 1553 BCE");
    cy.get("[data-testid=new-died]").type("c. 1450 BCE");
    cy.get("[data-testid=submit-doc]").click();
    cy.hubTitle("Caleb");
    cy.get("[data-testid=date-born]").should("have.attr", "data-valid", "true");
    cy.get("[data-testid=date-died]").should("have.attr", "data-valid", "true");
    cy.tutorialCommand("nav.timeline");
    cy.get("h1").should("contain", "Timeline");
    cy.get("[data-testid=tl-search]").type("Caleb");
    cy.docByTitle("Caleb").then((d) => {
      // One Lane of its own, and the Span drawn on it as a bar.
      cy.get(`[data-testid=tl-lane][data-lane=${d.id}]`).should("have.attr", "data-type", "character").and("contain", "Caleb");
      cy.get(`[data-testid=tl-lane][data-lane=${d.id}] [data-testid=tl-mark][data-doc=${d.id}] rect`).should("exist");
    });
    cy.get("[data-testid=tl-search]").clear();
    cy.tutorialDone();
  });
});
