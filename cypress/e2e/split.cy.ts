// The talk and its Board side by side (PLAN §22). Cypress runs at 1280x720,
// which fits both sides once the sidebar is out of the way.
describe("Split", () => {
  beforeEach(() => cy.openApp());

  const openSplit = (title = "Talk on endurance") => {
    cy.openDoc(title);
    cy.get("[data-sidebar=trigger]").first().click();
    cy.get("[data-testid=tab-split]").click();
    cy.get("[data-testid=split-talk] .cm-content").should("exist");
    cy.get("[data-testid=split-board] [data-testid=board-canvas]").should(
      "exist",
    );
  };

  /** Select the demo Board's first bubble. */
  const selectBubble = () => {
    cy.contains(
      "[data-testid=board-canvas] div",
      "Trials feel like the opposite of joy.",
    ).click();
    cy.get("[data-testid=board-selection]").should(
      "have.attr",
      "data-count",
      "1",
    );
  };

  it("shows the talk and the Board together", () => {
    openSplit();
    cy.get("[data-testid=tab-split]").should(
      "have.attr",
      "aria-selected",
      "true",
    );
    cy.get("[data-testid=split-talk] .cm-content").should(
      "contain",
      "Enduring with joy",
    );
    cy.get("[data-testid=split-board]").should(
      "contain",
      "Trials feel like the opposite of joy.",
    );
    // The editor is still there, so its tools stay in the header.
    cy.get("[data-testid=toggle-panel]").should("exist");
  });

  it("keeps the side panel beside a split", () => {
    openSplit();
    cy.get("[data-testid=right-panel]").then(($p) => {
      if (!$p.is(":visible")) cy.get("[data-testid=toggle-panel]").click();
    });
    cy.get("[data-testid=right-panel]").should("be.visible");
    cy.get("[data-testid=split-talk]").should("be.visible");
    cy.get("[data-testid=split-board]").should("be.visible");
  });

  it("does not delete a Board node on Backspace typed in the talk", () => {
    openSplit();
    selectBubble();
    cy.get("[data-testid=split-talk] .cm-content").click().type("x{backspace}");
    cy.get("[data-testid=board-canvas]").should(
      "contain",
      "Trials feel like the opposite of joy.",
    );
    // The selection survives, inert, and the Board's keys work again once it
    // has focus.
    cy.get("[data-testid=board-selection]").should(
      "have.attr",
      "data-count",
      "1",
    );
  });

  it("leaves select-all in the talk to the talk", () => {
    openSplit();
    selectBubble();
    cy.get("[data-testid=split-talk] .cm-content").click().type("{selectall}");
    cy.get("[data-testid=board-selection]").should(
      "have.attr",
      "data-count",
      "1",
    );
  });

  it("deletes a node with the keyboard once the Board has focus", () => {
    openSplit();
    cy.get("[data-testid=split-talk] .cm-content").click();
    selectBubble();
    cy.focused().should("have.attr", "data-testid", "board-root");
    cy.get("body").type("{del}");
    cy.get("[data-testid=board-canvas]").should(
      "not.contain",
      "Trials feel like the opposite of joy.",
    );
  });

  it("moves the divider with the keyboard, within the minimums", () => {
    openSplit();
    cy.get("[data-testid=split-divider]")
      .should("have.attr", "aria-valuenow", "50")
      .focus()
      .type("{leftarrow}{leftarrow}")
      .should("have.attr", "aria-valuenow", "40");
    // Held down, it stops where the talk reaches its minimum width.
    cy.get("[data-testid=split-divider]").type("{leftarrow}".repeat(20));
    cy.get("[data-testid=split-talk]").should(($t) => {
      expect($t[0].getBoundingClientRect().width).to.be.at.least(319);
    });
  });

  it("marks a Candidate placed from the drawer as on the Board, live", () => {
    openSplit();
    cy.get("[data-testid=right-panel]").then(($p) => {
      if (!$p.is(":visible")) cy.get("[data-testid=toggle-panel]").click();
    });
    cy.get("[data-testid=right-panel] [data-testid=candidates]")
      .parent()
      .should("contain", "Undeserved kindness in Romans");
    // Beside the talk the drawer starts closed (PLAN §22.3).
    cy.get("[data-testid=board-drawer]").should("not.exist");
    cy.get("[data-testid=board-drawer-open]").click();
    cy.get("[data-testid=board-drawer]")
      .contains("Undeserved kindness in Romans")
      .click();
    // No reload and no tab change: the panel beside the Board catches up.
    cy.get("[data-testid=right-panel]")
      .contains("button", "On the Board")
      .then(($b) => {
        if ($b.attr("data-state") !== "open") cy.wrap($b).click();
      });
    cy.get("[data-testid=right-panel] [data-testid=on-board]", {
      timeout: 5000,
    })
      .parent()
      .should("contain", "Undeserved kindness in Romans");
  });

  it("comes back split after a card opened in reading mode", () => {
    openSplit();
    cy.get("[data-testid=board-mode]").click();
    cy.contains(
      "[data-testid=board-canvas] div",
      "Endurance in trials",
    ).click();
    cy.get("[data-testid=split]").should("not.exist");
    cy.get(".cm-content", { timeout: 10000 }).should("contain", "Endurance");
    cy.get("[data-testid=doc-back]").click();
    cy.get("[data-testid=split-board] [data-testid=board-canvas]").should(
      "exist",
    );
  });

  it("shows the talk where both sides do not fit", () => {
    openSplit();
    cy.viewport(600, 720);
    cy.get("[data-testid=tab-split]").should("not.exist");
    cy.get("[data-testid=split]").should("not.exist");
    cy.get("[data-testid=tab-talk]").should(
      "have.attr",
      "aria-selected",
      "true",
    );
    cy.get(".cm-content").should("contain", "Enduring with joy");
    // Room again: the split the user chose comes back.
    cy.viewport(1280, 720);
    cy.get("[data-testid=split]").should("exist");
  });
});
