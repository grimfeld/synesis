// Walks the Mentions & Tags Tutorial (docs/tutorials/mentions.en.md) step by
// step, doing what each step says, so a change to links, Tags or Backlinks
// that outdates the Tutorial fails here (PLAN §24.13).
describe("Tutorial: Mentions & Tags", () => {
  beforeEach(() => cy.openApp());

  const saved = () => {
    cy.wait(1000);
    cy.get("[data-testid=save-status]").should("have.attr", "data-status", "saved");
  };

  it("can be followed to the end", () => {
    // The editor lists this Tutorial.
    cy.openDoc("Endurance in trials");
    cy.get(".cm-content").should("contain", "Endurance in trials");
    cy.openTutorial("mentions");

    // 1. A link in a sentence and a Tag chip each open the page they name.
    cy.tutorialStep(0);
    cy.get("[data-testid=chips-tags] [data-testid=chip]").should("contain", "#endurance");
    cy.get(".cm-wikilink").contains("Paul").click();
    cy.hubTitle("Paul");
    cy.tutorialNext();

    // 2. Backlinks list the Note once; a Tag's row is marked #.
    cy.tutorialStep(1);
    cy.get("[data-testid=backlinks]").should("contain", "Endurance in trials");
    cy.get("button[aria-label=Back]").click();
    cy.get("[data-testid=doc-title]").should("have.value", "Endurance in trials");
    cy.get("[data-testid=chips-tags]").contains("button", "#endurance").click();
    cy.hubTitle("Endurance");
    cy.get("[data-testid=backlinks] [data-testid=backlink-row]")
      .filter(':contains("Endurance in trials")')
      .should("have.length", 1)
      .and("contain", "#");
    cy.tutorialNext();

    // 3. A practice Note, and a link inserted with the Insert link Command.
    cy.tutorialStep(2);
    cy.tutorialCommand("create.note");
    cy.get("[data-testid=new-doc-title]").type("Mention practice");
    cy.get("[data-testid=submit-doc]").click();
    cy.get("[data-testid=doc-title]").should("have.value", "Mention practice");
    cy.get(".cm-content").click().type("{ctrl}{end}{enter}Jesus prayed in ");
    cy.tutorialCommand("editor.link");
    // The Command types `[[`, keeps the editor focused and opens the list.
    cy.focused().type("Geth", { delay: 150 });
    cy.get(".cm-tooltip-autocomplete").should("contain", "Gethsemane");
    cy.focused().type("{enter}");
    saved();
    cy.docByTitle("Mention practice").then((d) => {
      cy.task<string>("file:read", `${Cypress.env("vault")}/${d.path}`).then((text) => {
        expect(text).to.contain("Jesus prayed in [[Gethsemane]]");
      });
    });
    cy.tutorialNext();

    // 4. Do it once: a Tag under the title; both pages list the Note.
    cy.tutorialStep(3);
    cy.get("[data-testid=chips-tags] [data-testid=chip-add]").should("contain", "Add tag").click();
    cy.get("[data-testid=chips-tags] input").type("prayer{enter}");
    cy.get("[data-testid=chips-tags] [data-testid=chip]").should("contain", "#prayer");
    saved();
    cy.get("[data-testid=chips-tags]").contains("button", "#prayer").click();
    cy.hubTitle("Prayer");
    cy.get("[data-testid=backlinks] [data-testid=backlink-row]")
      .filter(':contains("Mention practice")')
      .should("have.length", 1)
      .and("contain", "#");
    cy.get("button[aria-label=Back]").click();
    cy.get("[data-testid=doc-title]").should("have.value", "Mention practice");
    cy.get(".cm-wikilink").contains("Gethsemane").click();
    cy.hubTitle("Gethsemane");
    cy.get("[data-testid=backlinks]").should("contain", "Mention practice");
    cy.tutorialDone();
  });
});
