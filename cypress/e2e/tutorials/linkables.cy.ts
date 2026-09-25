// Walks the Linkables & Unlinked mentions Tutorial
// (docs/tutorials/linkables.en.md) step by step, doing what each step says,
// so a change to either list that outdates the Tutorial fails here
// (PLAN §22.13).
describe("Tutorial: Linkables & Unlinked mentions", () => {
  beforeEach(() => cy.openApp());

  const saved = () => {
    cy.wait(1000);
    cy.get("[data-testid=save-status]").should("have.attr", "data-status", "saved");
  };

  it("can be followed to the end", () => {
    // The editor lists this Tutorial.
    cy.openDoc("The brothers at Antioch");
    cy.get(".cm-content").should("contain", "The brothers at Antioch");
    cy.openTutorial("linkables");

    // 1. Linkable names: one row per name, counted when written twice.
    cy.tutorialStep(0);
    cy.get("[data-testid=right-panel]").should("contain", "Linkable names");
    cy.get("[data-testid=linkables]")
      .parent()
      .should("contain", "Paul")
      .and("contain", "2×")
      .and("contain", "Troas");
    cy.tutorialNext();

    // 2. Clicking a name selects where it is written.
    cy.tutorialStep(1);
    cy.get("[data-testid=linkables]").parent().contains("button", "Troas").click();
    cy.window().then((win) => {
      expect(String(win.getSelection())).to.equal("Troas");
    });
    cy.get("button[aria-label='Link: Troas']").should("exist");
    cy.tutorialNext();

    // 3. The Subject's page lists the Note under Unlinked mentions, beside Backlinks.
    cy.tutorialStep(2);
    cy.openDoc("Antioch");
    cy.hubTitle("Antioch");
    cy.get("[data-testid=backlinks]").should("exist");
    cy.get("[data-testid=unlinked-mentions]")
      .should("contain", "The brothers at Antioch")
      .and("contain", "first called Christians");
    cy.tutorialNext();

    // 4. Do it once: a new Note naming two Subjects; one linked from the
    // panel, the other from the Subject's page.
    cy.tutorialStep(3);
    cy.tutorialCommand("create.note");
    cy.get("[data-testid=new-doc-title]").type("Linkable practice");
    cy.get("[data-testid=submit-doc]").click();
    cy.get("[data-testid=doc-title]").should("have.value", "Linkable practice");
    cy.get(".cm-content").click().type("{ctrl}{end}{enter}Moses came out of Egypt.");
    cy.get("[data-testid=linkables]", { timeout: 10000 })
      .parent()
      .should("contain", "Moses")
      .and("contain", "Egypt");
    cy.get("button[aria-label='Link: Moses']").click();
    cy.get("[data-testid=linkables]", { timeout: 10000 }).parent().should("not.contain", "Moses");
    saved();
    cy.openDoc("Egypt");
    cy.hubTitle("Egypt");
    cy.get("[data-testid=unlinked-mentions]", { timeout: 10000 }).should("contain", "Linkable practice");
    cy.get("[data-testid=unlinked-mentions] button[aria-label='Link: Linkable practice']").click();
    cy.get("[data-testid=unlinked-mentions]", { timeout: 10000 }).should("not.contain", "Linkable practice");
    cy.get("[data-testid=backlinks]").should("contain", "Linkable practice");
    // The words stay as written; only the brackets are new.
    cy.docByTitle("Linkable practice").then((d) => {
      cy.bridge<{ text: string }>("get_document", { id: d.id }).then((doc) => {
        expect(doc.text).to.contain("[[Moses]] came out of [[Egypt]].");
      });
    });
    cy.tutorialDone();
  });
});
