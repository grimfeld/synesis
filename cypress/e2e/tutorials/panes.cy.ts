// Walks the Two documents side by side Tutorial (docs/tutorials/panes.en.md)
// step by step on the demo vault's "Endurance in trials", so a change to
// Panes that outdates the Tutorial fails here (PLAN §25.13, spec #35).
describe("Tutorial: Two documents side by side", () => {
  beforeEach(() => cy.openApp());

  const pane = (i: 0 | 1) => `[data-testid=pane][data-pane=${i}]`;

  it("can be followed to the end", () => {
    // Two Panes of 320px fit beside the Tutorial panel and the side panel
    // once the sidebar is out of the way, as the Tutorial says.
    cy.openDoc("Endurance in trials");
    cy.get("[data-sidebar=trigger]").first().click();
    cy.openTutorial("panes");

    // 1. Open the Note with Search, then Cmd/Ctrl-click a link in it.
    cy.tutorialStep(0);
    cy.tutorialCommand("nav.search");
    cy.get("[data-testid=palette] input[cmdk-input]").type("endurance in trials");
    cy.get("[data-testid=palette] [cmdk-item]").first().should("contain", "Endurance in trials");
    cy.get("[data-testid=palette] input[cmdk-input]").type("{enter}");
    cy.get(`${pane(0)} [data-testid=doc-title]`).should("have.value", "Endurance in trials");
    cy.get(`${pane(0)} .cm-content [data-link="Undeserved kindness in Romans"]`).first().click({ ctrlKey: true });
    cy.get("[data-testid=panes]").should("have.attr", "data-count", "2");
    cy.get(`${pane(1)} [data-testid=doc-title]`).should("have.value", "Undeserved kindness in Romans");
    cy.get(`${pane(0)} [data-testid=doc-title]`).should("have.value", "Endurance in trials");
    cy.get(pane(1)).should("have.attr", "data-last-used", "true");
    cy.tutorialNext();

    // 2. The left Pane takes over the side panel, and Back moves it alone.
    cy.tutorialStep(1);
    cy.get(`${pane(0)} .cm-content`).click();
    cy.get(pane(0)).should("have.attr", "data-last-used", "true");
    // Open from the start at this width (1400px), beside both Panes.
    cy.get("[data-testid=right-panel]").should("be.visible");
    cy.docByTitle("Endurance in trials").then((d) => {
      cy.get("[data-testid=right-panel]").should("have.attr", "data-doc", d.id);
    });
    cy.get(`${pane(0)} .cm-content [data-link=Paul]`).first().click();
    cy.get(pane(0)).within(() => cy.hubTitle("Paul"));
    cy.tutorialCommand("nav.back");
    cy.get(`${pane(0)} [data-testid=doc-title]`).should("have.value", "Endurance in trials");
    cy.get(`${pane(1)} [data-testid=doc-title]`).should("have.value", "Undeserved kindness in Romans");
    cy.tutorialNext();

    // 3. The divider moves, by the arrow keys once clicked, within the minimum.
    cy.tutorialStep(2);
    cy.get("[data-testid=pane-divider]")
      .should("have.attr", "aria-valuenow", "50")
      .focus()
      .type("{rightarrow}")
      .should("have.attr", "aria-valuenow", "55");
    cy.get(pane(1)).should(($p) => expect($p[0].getBoundingClientRect().width).to.be.at.least(319));
    cy.tutorialNext();

    // 4. Swap: each document moves with its width.
    cy.tutorialStep(3);
    cy.tutorialCommand("pane.swap");
    cy.get(`${pane(0)} [data-testid=doc-title]`).should("have.value", "Undeserved kindness in Romans");
    cy.get(`${pane(1)} [data-testid=doc-title]`).should("have.value", "Endurance in trials");
    cy.get("[data-testid=pane-divider]").should("have.attr", "aria-valuenow", "45");
    cy.tutorialNext();

    // 5. Do it once: Cmd/Ctrl-click a link beside the text, then close that Pane.
    cy.tutorialStep(4);
    cy.get(`${pane(1)} .cm-content [data-link="Keep Enduring with Joy"]`).first().click({ ctrlKey: true });
    cy.get(pane(0)).within(() => cy.hubTitle("Keep Enduring with Joy"));
    cy.get(pane(0)).should("have.attr", "data-last-used", "true");
    cy.tutorialCommand("pane.close");
    cy.get("[data-testid=panes]").should("have.attr", "data-count", "1");
    cy.get(`${pane(1)} [data-testid=doc-title]`).should("not.exist");
    cy.get(`${pane(0)} [data-testid=doc-title]`).should("have.value", "Endurance in trials");
    cy.tutorialDone();
  });
});
