// Walks the Sources & the Library Tutorial (docs/tutorials/library.en.md)
// step by step, doing what each step says, so a change to the Library or a
// Source's page that outdates the Tutorial fails here (PLAN §24.13).
describe("Tutorial: Sources & the Library", () => {
  beforeEach(() => cy.openApp());

  it("can be followed to the end", () => {
    cy.runCommand("Go to Library");
    cy.get("[data-testid=library]").should("exist");
    cy.openTutorial("library");

    // 1. The Library: Shelves by kind, a Cover on every card.
    cy.tutorialStep(0);
    cy.tutorialCommand("nav.library");
    cy.get("[data-testid=shelf-book] [data-testid=library-card]").should("have.length", 2);
    cy.get("[data-testid=shelf-video]")
      .contains("[data-testid=library-card]", "Morning Worship")
      .find("[data-testid=cover-drawn]")
      .should("exist");
    cy.tutorialNext();

    // 2. A card opens the Source's page; its parts are under Contains, not on a Shelf.
    cy.tutorialStep(1);
    cy.get("[data-testid=shelf-periodical]")
      .contains("[data-testid=library-card]", "The Watchtower")
      .scrollIntoView()
      .click();
    cy.hubTitle("The Watchtower");
    cy.get("[data-testid=hub-trail]").should("contain", "Contains");
    cy.get("[data-testid=shelf-issue]").should("not.exist");
    cy.tutorialNext();

    // 3. Do it once: a new Source, a part inside it, both seen from the Library.
    cy.tutorialStep(2);
    cy.tutorialCommand("create.source");
    cy.get("[data-testid=new-doc-form] [data-testid=new-doc-title]").type("A Book I Am Reading");
    cy.get("[data-testid=new-doc-form] [data-slot=select-trigger]").click();
    cy.get("[role=option]").contains("Book").click();
    cy.get("[data-testid=submit-doc]").click();
    cy.hubTitle("A Book I Am Reading");
    cy.get("[data-testid=add-child-input]").type("Its First Chapter{enter}");
    cy.get("[data-testid=hub-trail]").should("contain", "Its First Chapter");
    cy.tutorialCommand("nav.library");
    cy.get("[data-testid=shelf-book]")
      .contains("[data-testid=library-card]", "A Book I Am Reading")
      .should("contain", "1 part");
    // The part sits inside its parent, never on a Shelf.
    cy.get("[data-testid=library]").should("not.contain", "Its First Chapter");
    cy.docByTitle("Its First Chapter").its("type").should("equal", "source");
    cy.tutorialDone();
  });
});
