// Walks the Family Tutorial (docs/tutorials/family-tree.en.md) step by step
// on the demo vault, so a change to Kinship that outdates the Tutorial fails
// here (PLAN §25.13). Steps 4 and 5 edit Kinship (#152); later parts (the
// Family tree view) add their steps here.
describe("Tutorial: Family", () => {
  beforeEach(() => cy.openApp());

  const kin = (row: string) => cy.get(`[data-testid=hub-family] [data-testid=family-${row}] [data-testid=family-kin]`);
  const fileOf = (title: string) =>
    cy.docByTitle(title).then((d) => cy.bridge<{ text: string }>("get_document", { id: d.id }).its("text"));

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

    // 4. Leah's Father: Choose…, then Create Character “Laban”.
    cy.tutorialStep(3);
    cy.tutorialCommand("nav.search");
    cy.get("[data-testid=palette] input[cmdk-input]").type("Leah");
    cy.contains("[data-testid=palette] [data-testid=palette-doc]", /^Leah/).click();
    cy.get("[data-testid=palette]").should("not.exist");
    cy.hubTitle("Leah");
    cy.get("[data-testid=family-father-choose]").click();
    cy.get("[data-testid=family-picker-input]").type("Laban");
    cy.get("[data-testid=picker-create]").should("contain", "Create Character “Laban”").click();
    kin("father").should("contain", "Laban");
    fileOf("Leah").should("match", /^father: "\[\[Laban\]\]"$/m);
    cy.get("[data-testid=family-father-clear]").should("exist");
    cy.tutorialNext();

    // 5. Add child on Joseph: asked father or mother, the child's file gains `father`.
    cy.tutorialStep(4);
    fileOf("Joseph").then((josephBefore) => {
      cy.openDoc("Joseph");
      cy.hubTitle("Joseph");
      cy.get("[data-testid=family-add-child]").click();
      cy.get("[data-testid=family-picker-input]").type("Manasseh");
      cy.get("[data-testid=picker-create]").click();
      cy.get("[data-testid=family-role-question]").should("be.visible");
      cy.get("[data-testid=family-role-father]").click();
      kin("children").should("contain", "Manasseh");
      fileOf("Manasseh").should("match", /^father: "\[\[Joseph\]\]"$/m);
      fileOf("Joseph").should("equal", josephBefore);
    });
    cy.tutorialNext();

    // 6. Do it once: set a Character's Father, then find them among his Children.
    cy.tutorialStep(5);
    cy.openDoc("Timothy");
    cy.hubTitle("Timothy");
    cy.get("[data-testid=family-father-choose]").click();
    cy.get("[data-testid=family-picker-input]").type("Paul");
    cy.contains("[data-testid=picker-option]", "Paul").click();
    kin("father").should("contain", "Paul").click();
    cy.hubTitle("Paul");
    kin("children").should("contain", "Timothy");
    cy.tutorialDone();
  });
});
