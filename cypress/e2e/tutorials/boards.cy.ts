// Walks the Boards Tutorial (docs/tutorials/boards.en.md) step by step, doing
// what each step says on the demo vault's "Talk on endurance", so a change to
// the Board that outdates the Tutorial fails here (PLAN §25.13).
describe("Tutorial: Boards", () => {
  beforeEach(() => cy.openApp());

  it("can be followed to the end", () => {
    // Opened from the Composition editor, which lists it. The sidebar goes out
    // of the way, as in board.cy.ts: at 1280x720 it covers the canvas middle.
    cy.openDoc("Talk on endurance");
    cy.get("[data-sidebar=trigger]").first().click();
    cy.openTutorial("boards");

    // 1. The Board Command switches the Composition to its Board.
    cy.tutorialStep(0);
    cy.tutorialCommand("doc.board");
    cy.get("[data-testid=board-canvas]").should("exist");
    cy.get("[data-testid=tab-board]").should("have.attr", "aria-selected", "true");
    cy.get("[data-testid=tutorial-panel]").should("be.visible");
    cy.tutorialNext();

    // 2. Add note, type, click the empty Board to finish.
    cy.tutorialStep(1);
    cy.get("[aria-label='Add note']").click();
    cy.focused().type("Joy is not the absence of trials");
    cy.get("[data-testid=board-canvas]").click("bottom");
    cy.wait(700); // the Board save is debounced
    cy.get("[data-testid=board-canvas]").should("contain", "Joy is not the absence of trials");
    cy.tutorialNext();

    // 3. A Candidate from the Material list lands as a card.
    cy.tutorialStep(2);
    cy.get("[data-testid=board-drawer]").contains("Undeserved kindness in Romans").click();
    cy.get("[data-testid=board-canvas]").should("contain", "Undeserved kindness in Romans");
    cy.tutorialNext();

    // 4. Add group, then name it by double-clicking its label.
    cy.tutorialStep(3);
    cy.get("[aria-label='Add group']").click();
    cy.contains("[data-testid=board-canvas] text", /^Group$/).dblclick({ force: true });
    cy.get("input[aria-label='Group label']").clear().type("Why endure{enter}");
    cy.contains("[data-testid=board-canvas] text", "Why endure").should("exist");
    cy.tutorialNext();

    // 5. Do it once: what was placed is saved with the Composition, and in
    // Reading a card opens its document.
    cy.tutorialStep(4);
    cy.wait(700); // the Board save is debounced
    cy.docByTitle("Talk on endurance").then((d) => {
      cy.bridge<{ nodes: { type: string; text?: string; label?: string; file?: string }[] }>("get_board", { id: d.id }).should((b) => {
        expect(b.nodes.some((n) => n.text === "Joy is not the absence of trials"), "the bubble").to.be.true;
        expect(b.nodes.some((n) => n.type === "group" && n.label === "Why endure"), "the group").to.be.true;
        expect(b.nodes.some((n) => n.file?.toLowerCase().includes("undeserved kindness in romans")), "the card").to.be.true;
      });
    });
    cy.get("[data-testid=board-mode]").click();
    cy.get("[data-testid=board-mode]").should("have.attr", "aria-pressed", "true");
    cy.contains("[data-testid=board-canvas] div", "Endurance in trials").click();
    cy.get("[data-testid=board-canvas]").should("not.exist");
    cy.get(".cm-content", { timeout: 10000 }).should("contain", "Endurance");
    cy.tutorialDone();
  });
});
