// Walks the Family Tutorial (docs/tutorials/family-tree.en.md) step by step
// on the demo vault, so a change to Kinship that outdates the Tutorial fails
// here (PLAN §25.13). Steps 4 and 5 edit Kinship (#152), step 6 reads a
// Relation (#153), step 7 reads the Family tree (#154), steps 8 and 9 focus
// it on one Character (#155).
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
    cy.contains("[data-testid=palette] [data-testid=palette-doc-name]", /^Jacob$/).click();
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
      cy.openDoc("Joseph", { exact: true });
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

    // 6. Elisha's Relations: "mentor: Elijah", and "mentor of: Elisha" on Elijah.
    cy.tutorialStep(5);
    fileOf("Elijah").then((elijahBefore) => {
      cy.tutorialCommand("nav.search");
      cy.get("[data-testid=palette] input[cmdk-input]").type("Elisha");
      cy.contains("[data-testid=palette] [data-testid=palette-doc-name]", /^Elisha$/).click();
      cy.get("[data-testid=palette]").should("not.exist");
      cy.hubTitle("Elisha");
      cy.get("[data-testid=hub-relations] [data-testid=hub-relation]")
        .should("have.length", 1)
        .and("contain", "mentor:")
        .find("button")
        .should("contain", "Elijah")
        .click();
      cy.hubTitle("Elijah");
      cy.get("[data-testid=hub-relations] [data-testid=hub-relation][data-direction=in]")
        .should("contain", "mentor of:")
        .and("contain", "Elisha");
      fileOf("Elijah").should("equal", elijahBefore);
    });
    cy.tutorialNext();

    // 7. The Family tree: everyone once, Abraham and Sarah under Terah, Jacob opens his Hub.
    cy.tutorialStep(6);
    cy.tutorialCommand("nav.family-tree");
    cy.get("[data-testid=family-tree]").should("be.visible");
    cy.docByTitle("Terah").then((terah) =>
      cy.docByTitle("Abraham").then((abraham) =>
        cy.docByTitle("Sarah").then((sarah) => {
          for (const id of [abraham.id, sarah.id]) {
            cy.get(`[data-testid=family-tree-person][data-id="${id}"]`).should("have.length", 1);
            cy.get(`[data-testid=family-tree-line][data-child="${id}"]`).should("have.attr", "data-parents", terah.id);
          }
        }),
      ),
    );
    cy.docByTitle("Jacob").then((jacob) => cy.get(`[data-testid=family-tree-person][data-id="${jacob.id}"]`).dblclick());
    cy.hubTitle("Jacob");
    cy.tutorialNext();

    // 8. Show in Family tree on Jacob: his line alone, then the generations.
    const person = (id: string) => cy.get(`[data-testid=family-tree-person][data-id="${id}"]`);
    cy.tutorialStep(7);
    cy.query<{ id: string; title: string }[]>({ kind: "list", docType: "character" }).then((docs) => {
      const id = (t: string) => docs.find((d) => d.title === t)!.id;
      cy.tutorialCommand("doc.show_in_family_tree");
      cy.get("[data-testid=family-tree]").should("have.attr", "data-focus", id("Jacob"));
      person(id("Isaac")).should("exist");
      person(id("Joseph")).should("exist");
      person(id("Leah")).should("exist");
      person(id("Esau")).should("not.exist");
      cy.get("[data-testid=family-tree-up]").click();
      cy.get("[data-testid=family-tree-up-1]").click();
      person(id("Isaac")).should("exist");
      person(id("Rebekah")).should("exist");
      person(id("Abraham")).should("not.exist");
      cy.get("[data-testid=family-tree-up]").click();
      cy.get("[data-testid=family-tree-up-all]").click();
      person(id("Terah")).should("exist");
      cy.tutorialNext();

      // 9. Joseph's card, Focus here, Back, the search box, Everyone.
      cy.tutorialStep(8);
      person(id("Joseph")).click();
      cy.get("[data-testid=family-tree-card-name]").should("have.text", "Joseph");
      cy.get("[data-testid=family-tree-card-span]").should("exist");
      cy.get("[data-testid=family-tree-card-focus]").click();
      cy.get("[data-testid=family-tree]").should("have.attr", "data-focus", id("Joseph"));
      cy.tutorialCommand("nav.back");
      cy.get("[data-testid=family-tree]").should("have.attr", "data-focus", id("Jacob"));
      cy.get("[data-testid=family-tree-search]").type("Benjamin");
      cy.get(`[data-testid=family-tree-search-result][data-id="${id("Benjamin")}"]`).click();
      cy.get("[data-testid=family-tree-card]").should("have.attr", "data-id", id("Benjamin"));
      cy.get("[data-testid=family-tree-everyone]").click();
      cy.get("[data-testid=family-tree]").should("not.have.attr", "data-focus");
      person(id("Esau")).should("exist");
    });
    cy.tutorialNext();

    // 10. Do it once: set a Character's Father, then find them among his Children, and below him in his line.
    cy.tutorialStep(9);
    cy.openDoc("Timothy", { exact: true });
    cy.hubTitle("Timothy");
    cy.get("[data-testid=family-father-choose]").click();
    cy.get("[data-testid=family-picker-input]").type("Paul");
    cy.contains("[data-testid=picker-option]", "Paul").click();
    kin("father").should("contain", "Paul").click();
    cy.hubTitle("Paul");
    kin("children").should("contain", "Timothy");
    cy.tutorialCommand("doc.show_in_family_tree");
    cy.docByTitle("Paul").then((paul) =>
      cy.docByTitle("Timothy").then((timothy) => {
        cy.get("[data-testid=family-tree]").should("have.attr", "data-focus", paul.id);
        cy.get(`[data-testid=family-tree-line][data-child="${timothy.id}"]`).should("have.attr", "data-parents", paul.id);
      }),
    );
    cy.tutorialDone();
  });
});
