// Walks the Talk and Board side by side Tutorial (docs/tutorials/split.en.md)
// step by step on the demo vault's "Talk on endurance", so a change to the
// split that outdates the Tutorial fails here (PLAN §25.13).
describe("Tutorial: Talk and Board side by side", () => {
  beforeEach(() => cy.openApp());

  it("can be followed to the end", () => {
    // At 1280x720 both sides fit beside the Tutorial panel only with the
    // sidebar and the side panel out of the way, as the Tutorial says.
    cy.openDoc("Talk on endurance");
    cy.get("[data-sidebar=trigger]").first().click();
    cy.get("[data-testid=toggle-panel]").then(($b) => {
      if ($b.attr("aria-pressed") === "true") cy.wrap($b).click();
    });
    cy.openTutorial("split");

    // 1. Open the Composition with Search, then Split: talk left, Board right.
    cy.tutorialStep(0);
    cy.tutorialCommand("nav.search");
    cy.get("[data-testid=palette] input[cmdk-input]").type("talk on endurance");
    cy.get("[data-testid=palette] [cmdk-item]").first().should("contain", "Talk on endurance");
    cy.get("[data-testid=palette] input[cmdk-input]").type("{enter}");
    cy.get("[data-testid=doc-title]").should("have.value", "Talk on endurance");
    cy.tutorialCommand("doc.split");
    cy.get("[data-testid=tab-split]").should("have.attr", "aria-selected", "true");
    cy.get("[data-testid=split-talk] .cm-content").should("contain", "Enduring with joy");
    cy.get("[data-testid=split-board] [data-testid=board-canvas]").should("exist");
    cy.get("[data-testid=tutorial-panel]").should("be.visible");
    cy.tutorialNext();

    // 2. The divider moves, by drag or by the arrow keys once clicked.
    cy.tutorialStep(1);
    cy.get("[data-testid=split-divider]")
      .should("have.attr", "aria-valuenow", "50")
      .focus()
      .type("{rightarrow}")
      .should("have.attr", "aria-valuenow", "55");
    cy.get("[data-testid=split-talk]").should(($t) => {
      expect($t[0].getBoundingClientRect().width).to.be.at.least(319);
    });
    cy.tutorialNext();

    // 3. A selected card survives the talk taking the keys.
    cy.tutorialStep(2);
    cy.contains("[data-testid=board-canvas] div", "Trials feel like the opposite of joy.").click();
    cy.get("[data-testid=board-selection]").should("have.attr", "data-count", "1");
    cy.get("[data-testid=split-talk] .cm-content").click();
    cy.focused().closest("[data-testid=split-talk]").should("exist");
    cy.get("[data-testid=board-selection]").should("have.attr", "data-count", "1");
    cy.tutorialNext();

    // 4. The Material list starts closed beside the talk and opens from its edge.
    cy.tutorialStep(3);
    cy.get("[data-testid=board-drawer]").should("not.exist");
    cy.get("[data-testid=board-drawer-open]").click();
    cy.get("[data-testid=board-drawer]").should("contain", "Undeserved kindness in Romans");
    cy.tutorialNext();

    // 5. Do it once: a bubble added on the Board beside the talk is saved.
    cy.tutorialStep(4);
    cy.get("[data-testid=split-board] [aria-label='Add note']").click();
    cy.focused().type("Endurance finishes its work");
    cy.get("[data-testid=split-board] [data-testid=board-canvas]").click("bottom");
    cy.get("[data-testid=board-canvas]").should("contain", "Endurance finishes its work");
    cy.get("[data-testid=split-talk] .cm-content").should("contain", "Enduring with joy");
    cy.wait(700); // the Board save is debounced
    cy.docByTitle("Talk on endurance").then((d) => {
      cy.bridge<{ nodes: { text?: string }[] }>("get_board", { id: d.id }).should((b) => {
        expect(b.nodes.some((n) => n.text === "Endurance finishes its work"), "the bubble").to.be.true;
      });
    });
    cy.tutorialDone();
  });
});
