// Walks the Family Tutorial (docs/tutorials/family-tree.en.md) step by step
// on the demo vault, so a change to Kinship that outdates the Tutorial fails
// here (PLAN §25.13). Later parts (the Family tree view) add their steps here.
describe("Tutorial: Family", () => {
  beforeEach(() => cy.openApp());

  const kin = (row: string) => cy.get(`[data-testid=hub-family] [data-testid=family-${row}] [data-testid=family-kin]`);

  it("can be followed to the end", () => {
    // A Character's Hub lists it.
    cy.openDoc("Paul");
    cy.hubTitle("Paul");
    cy.openTutorial("family-tree");

    // 1. Open Jacob's Hub with Search: his whole Family.
    cy.tutorialStep(0);
    cy.tutorialCommand("nav.search");
    cy.get("[data-testid=palette] input[cmdk-input]").type("Jacob");
    cy.contains("[data-testid=palette] [data-testid=palette-doc]", /^Jacob/).click();
    cy.get("[data-testid=palette]").should("not.exist");
    cy.hubTitle("Jacob");
    kin("father").should("contain", "Isaac");
    kin("mother").should("contain", "Rebekah");
    kin("spouses").should("have.length", 4);
    cy.get("[data-testid=family-children] [data-testid=family-child-group]").should("have.length", 4);
    kin("siblings").should("contain", "Esau");
    cy.tutorialNext();

    // 2. Isaac's Children are read from their files; Leah lists Jacob.
    cy.tutorialStep(1);
    kin("father").click();
    cy.hubTitle("Isaac");
    kin("children").should("contain", "Jacob").and("contain", "Esau");
    cy.tutorialNext();

    // 3. Siblings by the parents they share: Ishmael under Abraham alone.
    cy.tutorialStep(2);
    cy.get("[data-testid=family-sibling-group]")
      .should("have.length", 1)
      .find("[data-testid=family-sibling-group-heading]")
      .should("contain", "Abraham")
      .and("not.contain", "Sarah");
    kin("siblings").should("contain", "Ishmael");
    cy.tutorialCommand("nav.back");
    cy.hubTitle("Jacob");
    cy.tutorialNext();

    // 4. Do it once: open a Character's Hub and see their family.
    cy.tutorialStep(3);
    cy.openDoc("Joseph");
    cy.hubTitle("Joseph");
    kin("father").should("contain", "Jacob");
    kin("mother").should("contain", "Rachel");
    cy.contains("[data-testid=family-sibling-group]", "Jacob and Rachel").should("contain", "Benjamin");
    cy.tutorialDone();
  });
});
