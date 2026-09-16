// The Clippings view and what a title-less Clipping looks like (ADR 0013):
// its own words wherever one line is shown, its Citation where it came from.
describe("Clippings", () => {
  beforeEach(() => cy.openApp());

  const openClippings = () => {
    cy.runCommand("Go to Clippings");
    cy.get("[data-testid=clippings]").should("exist");
  };

  it("shows every Clipping as its own words, with its Citation", () => {
    openClippings();
    cy.get("[data-testid=clipping-card]").should("have.length", 4);
    // The card is the quote, not a name someone invented for it.
    cy.get("[data-testid=clippings]")
      .should("contain", "Endurance is not merely putting up")
      .and("contain", "Love waits before it speaks");
    // The Citation says where it came from.
    cy.get("[data-testid=clipping-card]")
      .contains("Endurance is not merely putting up")
      .parent()
      .find("[data-testid=clipping-citation]")
      .should("contain", "Keep Enduring with Joy")
      .and("contain", "par. 12");
  });

  it("narrows by Tag and by Source, and clears again", () => {
    openClippings();
    cy.get("[data-testid=clippings-tag-endurance]").click();
    cy.get("[data-testid=clipping-card]").should("have.length", 1);
    cy.get("[data-testid=clippings]").should(
      "contain",
      "Endurance is not merely putting up",
    );
    cy.get("[data-testid=clippings-clear]").click();
    cy.get("[data-testid=clipping-card]").should("have.length", 4);
  });

  it("opens a Clipping on its Citation, with no title to edit", () => {
    openClippings();
    cy.get("[data-testid=clipping-card]")
      .contains("Endurance is not merely putting up")
      .click();
    // A Clipping has no title, so the header is its Citation and there is no
    // title input to type into.
    cy.get("[data-testid=doc-citation]")
      .should("contain", "Keep Enduring with Joy")
      .and("contain", "par. 12");
    cy.get("[data-testid=doc-title]").should("not.exist");
    cy.get(".cm-content").should("contain", "remaining steadfast");
  });

  it("a Source Hub reads its Clippings before its reading trail", () => {
    cy.openDoc("Keep Enduring with Joy");
    cy.get("[data-testid=hub-clippings]")
      .should("contain", "Endurance is not merely putting up")
      .and("contain", "par. 12");
  });

  it("names a new Clipping from its Citation, never from a title", () => {
    cy.runCommand("New Clipping");
    // There is no Title field to fill.
    cy.get("[data-testid=new-doc-title]").should("not.exist");
    cy.get("[data-testid=new-doc-form] textarea").type(
      "A borrowed sentence worth keeping.",
    );
    cy.get(
      "[data-testid=new-doc-form] input[placeholder*='Existing Source']",
    ).type("Keep Enduring");
    // The picker's rows commit on mousedown, before the input loses focus.
    // The list is a sibling of the input, not a child, so it is scoped by the
    // picker's wrapper rather than by the testid on the input itself.
    cy.get("[data-testid=source-picker]")
      .parent()
      .contains("li button", "Keep Enduring with Joy")
      .trigger("mousedown");
    cy.get("[data-testid=new-doc-form] input[placeholder^='par. 12']").type(
      "par. 20",
    );
    cy.get("[data-testid=submit-doc]").click();
    // The file is named by its Citation, and the page shows the quote.
    cy.get("[data-testid=doc-citation]").should(
      "contain",
      "Keep Enduring with Joy",
    );
    cy.get(".cm-content").should("contain", "A borrowed sentence worth keeping");
  });
});
