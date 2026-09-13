// The Board of a Composition: a JSON Canvas laid out by hand (ADR 0009).
// The demo vault's "Talk on endurance" ships a Board with every node type.
describe("Board", () => {
  beforeEach(() => cy.openApp());

  /**
   * Open a Composition's Board with the sidebar out of the way. Cypress runs
   * at 1280x720, where the sidebar covers the middle of the canvas that a new
   * node is dropped into, so a click meant for the Board hits a nav item.
   */
  const openBoard = (title: string) => {
    cy.openDoc(title);
    cy.get("[data-sidebar=trigger]").first().click();
    cy.get("[data-testid=tab-board]").click();
  };

  it("opens from the tab on a Composition and shows the demo Board", () => {
    openBoard("Talk on endurance");
    cy.get("[data-testid=board-canvas]").should("exist");
    // Every node type from the demo file.
    cy.get("[data-testid=board-canvas]").within(() => {
      cy.contains("Trials feel like the opposite of joy.").should("exist");
      cy.contains("Endurance is steadfastness").should("exist");
      cy.contains("Opening").should("exist");
      cy.contains("because").should("exist");
    });
    // Back to the text.
    cy.get("[data-testid=tab-talk]").click();
    cy.get(".cm-content").should("contain", "Enduring with joy");
  });

  it("is offered only on Compositions", () => {
    cy.openDoc("Endurance in trials");
    cy.get("[data-testid=tab-board]").should("not.exist");
  });

  it("adds a note and keeps it after a reload", () => {
    openBoard("Talk on endurance");
    cy.get("[aria-label='Add note']").click();
    cy.focused().type("A new thought");
    cy.get("[data-testid=board-canvas]").click("bottom");
    cy.wait(700); // the Board save is debounced
    cy.get("[data-testid=board-canvas]").should("contain", "A new thought");

    // The engine wrote it: the Board survives the round trip to disk.
    cy.docByTitle("Talk on endurance").then((d) => {
      cy.bridge<{ nodes: { text?: string }[] }>("get_board", {
        id: d.id,
      }).should((b) => {
        expect(b.nodes.some((n) => n.text === "A new thought")).to.be.true;
      });
    });
  });

  it("places material from the drawer and marks it on the Board", () => {
    openBoard("Talk on endurance");
    // A Candidate that is not on the Board yet.
    cy.get("[data-testid=board-drawer]")
      .contains("Undeserved kindness in Romans")
      .click();
    cy.get("[data-testid=board-canvas]").should(
      "contain",
      "Undeserved kindness in Romans",
    );
    // Placing it does not make it used: it is still a Candidate, now marked.
    cy.get("[data-testid=tab-talk]").click();
    cy.get("[data-testid=right-panel]")
      .contains("button", "On the Board")
      .then(($b) => {
        // The Section remembers its open state, so only click it shut-to-open.
        if ($b.attr("data-state") !== "open") cy.wrap($b).click();
      });
    cy.get("[data-testid=right-panel] [data-testid=on-board]")
      .parent()
      .should("contain", "Undeserved kindness in Romans");
    cy.get("[data-testid=right-panel] [data-testid=candidates]")
      .parent()
      .should("not.contain", "Undeserved kindness in Romans");
  });

  it("reports the Boards a document sits on", () => {
    // Material placed on a Board is visible from the document's side, so a
    // Board is not a one-way mirror (PLAN §16.6).
    cy.docByTitle("Endurance in trials").then((d) => {
      cy.bridge<{ title: string }[]>("boards_referencing", {
        id: d.id,
      }).should((rows) => {
        expect(rows.map((r) => r.title)).to.include("Talk on endurance");
      });
    });
    // A document on no Board reports none.
    cy.docByTitle("Psalm 23 reflections").then((d) => {
      cy.bridge<unknown[]>("boards_referencing", { id: d.id }).should(
        "have.length",
        0,
      );
    });
  });

  it("deletes a node with the keyboard", () => {
    openBoard("Talk on endurance");
    cy.get("[aria-label='Add note']").click();
    cy.focused().type("Doomed");
    cy.get("[data-testid=board-canvas]").click("bottom");
    cy.wait(700); // the Board save is debounced
    cy.get("[data-testid=board-canvas]").should("contain", "Doomed");
    cy.contains("[data-testid=board-canvas] div", "Doomed").click();
    cy.get("body").type("{del}");
    cy.get("[data-testid=board-canvas]").should("not.contain", "Doomed");
  });

  it("keeps fields it does not understand through an edit", () => {
    // The hard requirement (PLAN §16.8): Obsidian's keys must survive us.
    cy.docByTitle("Talk on endurance").then((d) => {
      cy.bridge<{ nodes: Record<string, unknown>[]; edges: unknown[] }>(
        "get_board",
        { id: d.id },
      ).then((board) => {
        const nodes = board.nodes.map((n, i) =>
          i === 0 ? { ...n, styleAttributes: { shape: "diamond" } } : n,
        );
        cy.bridge("save_board", { id: d.id, board: { ...board, nodes } }).then(
          () => {
            cy.openApp();
            openBoard("Talk on endurance");
            // Move something, forcing a save from the app.
            cy.get("[aria-label='Add note']").click();
            cy.focused().type("Nudge");
            cy.get("[data-testid=board-canvas]").click("bottom");
            cy.wait(700); // the Board save is debounced
            cy.bridge<{ nodes: Record<string, unknown>[] }>("get_board", {
              id: d.id,
            }).should((after) => {
              const kept = after.nodes.find((n) => n.styleAttributes);
              expect(kept, "unknown field destroyed").to.exist;
            });
          },
        );
      });
    });
  });
});
