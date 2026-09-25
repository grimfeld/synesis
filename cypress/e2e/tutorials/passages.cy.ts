// Walks the Passages Tutorial (docs/tutorials/passages.en.md) step by step,
// doing what each step says, so a change to Passage detection, the hover card
// or the Open a Passage dialog that outdates the Tutorial fails here
// (PLAN §25.13).
describe("Tutorial: Passages", () => {
  beforeEach(() => cy.openApp());

  it("can be followed to the end", () => {
    // The editor lists this Tutorial.
    cy.openDoc("Endurance in trials");
    cy.get(".cm-content").should("contain", "Endurance in trials");
    cy.openTutorial("passages");

    // 1. References with a chapter number are underlined as Passages.
    cy.tutorialStep(0);
    cy.get(".cm-passage").should("contain", "Jas 1:2-4").and("contain", "Ro 5:3-5");
    cy.tutorialNext();

    // 2. Clicking one shows the card; Open page goes to its Verse page.
    cy.tutorialStep(1);
    cy.get(".cm-passage").contains("Jas 1:2-4").click();
    cy.get("[data-testid=hover-card]").should("be.visible").and("contain", "Open page");
    cy.get("[data-testid=hover-card]").contains("button", "Open page").click();
    cy.hubTitle("James 1:2");
    cy.get("[data-testid=hub-mentions]").should("contain", "Endurance in trials");
    cy.tutorialNext();

    // 3. Open a Passage reaches a page with nothing to click.
    cy.tutorialStep(2);
    cy.tutorialCommand("nav.passage");
    cy.get("[data-testid=goto-passage] input").type("John 3:16");
    cy.get("[data-testid=goto-passage]").contains("button", "Open").click();
    cy.hubTitle("John 3:16");
    cy.tutorialNext();

    // 4. Do it once: a new Note with an English and a French reference.
    cy.tutorialStep(3);
    cy.tutorialCommand("create.note");
    cy.get("[data-testid=new-doc-title]").type("Passage practice");
    cy.get("[data-testid=submit-doc]").click();
    cy.get("[data-testid=doc-title]").should("have.value", "Passage practice");
    cy.get(".cm-content").click().type("{ctrl}{end}{enter}Ro 12:2 and Jean 3,16.");
    // Both are detected as typed, the French book name included.
    cy.get(".cm-passage").should("contain", "Ro 12:2").and("contain", "Jean 3,16");
    cy.wait(1000);
    cy.get("[data-testid=save-status]").should("have.attr", "data-status", "saved");
    // Never rewritten: the file holds the words as typed.
    cy.docByTitle("Passage practice").then((d) => {
      cy.task<string>("file:read", `${Cypress.env("vault")}/${d.path}`).then((text) => {
        expect(text).to.contain("Ro 12:2 and Jean 3,16.");
      });
    });
    cy.get(".cm-passage").contains("Ro 12:2").click();
    cy.get("[data-testid=hover-card]").contains("button", "Open page").click();
    cy.hubTitle("Romans 12:2");
    cy.get("[data-testid=hub-mentions]", { timeout: 10000 }).should("contain", "Passage practice");
    cy.tutorialDone();
  });
});
