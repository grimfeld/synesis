// Walks the Compositions & Embeds Tutorial (docs/tutorials/compositions.en.md)
// step by step, doing what each step says, so a change to Compositions or
// Embeds that outdates the Tutorial fails here (PLAN §22.13).
describe("Tutorial: Compositions & Embeds", () => {
  beforeEach(() => cy.openApp());

  it("can be followed to the end", () => {
    // Home lists this Tutorial; the app opens there.
    cy.openTutorial("compositions");

    // 1. A new Composition opens in the editor and is listed on Home.
    cy.tutorialStep(0);
    cy.tutorialCommand("create.composition");
    cy.get("[data-testid=new-doc-form] [data-testid=new-doc-title]").type("A Talk of My Own");
    cy.get("[data-testid=submit-doc]").click();
    cy.get("[data-testid=doc-title]").should("have.value", "A Talk of My Own");
    cy.tutorialCommand("nav.home");
    cy.get("[data-testid=home-progress]").contains("button", "A Talk of My Own").click();
    cy.get("[data-testid=doc-title]").should("have.value", "A Talk of My Own");
    cy.tutorialNext();

    // 2. Write in your own words; consult a Note and come back.
    cy.tutorialStep(1);
    cy.get(".cm-content").click().type("Trials can be faced with joy.");
    cy.tutorialCommand("nav.search");
    cy.get("[data-testid=palette] input[cmdk-input]").type("endurance in trials");
    cy.get("[data-testid=palette] [cmdk-item]").first().should("contain", "Endurance in trials");
    cy.get("[data-testid=palette] input[cmdk-input]").type("{enter}");
    cy.get("[data-testid=doc-title]").should("have.value", "Endurance in trials");
    cy.tutorialCommand("nav.back");
    cy.get("[data-testid=doc-title]").should("have.value", "A Talk of My Own");
    cy.get(".cm-content").should("contain", "Trials can be faced with joy.");
    cy.tutorialNext();

    // 3. Do it once: embed a Clipping on a new line; it shows live below it.
    cy.tutorialStep(2);
    cy.get(".cm-content").click().type("{ctrl}{end}");
    cy.get(".cm-content").type("{enter}");
    cy.tutorialCommand("editor.embed");
    cy.get(".cm-tooltip-autocomplete").should("exist");
    // A few words of the Source, at a person's pace, then the Clipping picked
    // from the list: the Source itself ranks first, the Clipping under it.
    cy.focused().type("keep enduring", { delay: 150 });
    cy.get(".cm-tooltip-autocomplete li").contains("par. 12").click();
    cy.get(".cm-embed-box").should("contain", "Endurance is not merely putting up");
    cy.wait(1000);
    cy.docByTitle("A Talk of My Own").then((d) => {
      cy.task<string>("file:read", `${Cypress.env("vault")}/${d.path}`).then((text) => {
        expect(text).to.contain("Trials can be faced with joy.");
        expect(text).to.match(/!\[\[Keep enduring with joy par\. 12[^\]]*\]\]/i);
      });
    });
    cy.tutorialDone();
  });
});
