// Walks the Hubs & Backlinks Tutorial (docs/tutorials/hubs.en.md) step by step
// on the demo vault, so a change to Hubs that outdates the Tutorial fails here
// (PLAN §24.13).
describe("Tutorial: Hubs & Backlinks", () => {
  beforeEach(() => cy.openApp());

  it("can be followed to the end", () => {
    // Every Hub lists it; start from a Character's.
    cy.openDoc("Paul");
    cy.hubTitle("Paul");
    cy.openTutorial("hubs");

    // 1. Open a Hub by name with Search.
    cy.tutorialStep(0);
    cy.tutorialCommand("nav.search");
    cy.get("[data-testid=palette] input[cmdk-input]").type("Antioch");
    cy.get("[data-testid=palette] [cmdk-item]").contains("Antioch").click();
    cy.get("[data-testid=palette]").should("not.exist");
    cy.hubTitle("Antioch");
    cy.get("[data-testid=hub-header]").should("contain", "Place");
    cy.get("[data-testid=hub-map]").should("exist");
    cy.tutorialNext();

    // 2. Backlinks: one row per document, its Mentions behind the arrow.
    // "Paul's second missionary journey" names Antioch twice, out and back.
    cy.tutorialStep(1);
    cy.get("[data-testid=backlinks] [data-testid=backlink-row]")
      .filter(':contains("second missionary journey")')
      .should("have.length", 1)
      .as("row");
    cy.get("@row").find("[data-testid=backlink-count]").should("contain", "2 mentions");
    cy.get("@row").find("[data-testid=backlink-expand]").click();
    cy.get("@row").find("[data-testid=backlink-occurrences] li").should("have.length", 2);
    cy.tutorialNext();

    // 3. A Backlink opens its document; Back returns to the Hub.
    cy.tutorialStep(2);
    cy.get("@row").find("button").first().click();
    cy.hubTitle("Paul's second missionary journey");
    cy.tutorialCommand("nav.back");
    cy.hubTitle("Antioch");
    cy.tutorialNext();

    // 4. Do it once: write an About on a Hub whose About is empty.
    cy.tutorialStep(3);
    cy.openDoc("Timothy");
    cy.hubTitle("Timothy");
    cy.get("[data-testid=hub-about] button").contains("Add a note about Timothy").click();
    cy.get("[data-testid=hub-about] .cm-content").should("be.visible").type("Paul's companion from Lystra, Ac 16:1.");
    cy.get("[data-testid=hub-about] .cm-passage").should("contain", "Ac 16:1");
    cy.wait(1000); // the Hub's save is debounced
    cy.docByTitle("Timothy").then((d) => {
      cy.task<string>("file:read", `${Cypress.env("vault")}/${d.path}`).then((text) =>
        expect(text).to.contain("Paul's companion from Lystra"),
      );
    });
    cy.tutorialDone();
  });
});
