// The talk and its Board side by side (PLAN §22). Cypress runs at 1280x720,
// which fits both sides once the sidebar is out of the way.
import { dragRowOntoLine, storedText } from "../support/drag";

/** A Material drawer row's button, by document id. */
const drawerRow = (id: string) =>
  `[data-testid=board-drawer] [data-testid=board-drawer-row][data-doc="${id}"] button`;

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

  // Spec #202: the drawer's material drags into the talk beside it, as the
  // side panel's does, and a drag never places it on the Board.
  it("drags a Candidate from the Material drawer into the talk", () => {
    cy.bridge<{ summary: { id: string; path: string } }>("create_document", {
      docType: "clipping",
      title: "",
      fields: {
        source: "[[Keep Enduring with Joy]]",
        locator: "par. 9",
        tags: ["endurance"],
      },
      body: "> Joy from the drawer.\n",
    }).then(({ summary }) => {
      const stem = summary.path.replace(/\.md$/, "").split("/").pop();
      const embed = `![[${stem}|Keep Enduring with Joy · par. 9]]`;
      cy.openApp();
      openSplit();
      cy.get("[data-testid=board-drawer-open]").click();
      cy.get(drawerRow(summary.id)).should("have.attr", "draggable", "true");
      dragRowOntoLine(
        drawerRow(summary.id),
        "Ro 15:5 calls God",
        "[data-testid=split-talk]",
      );
      cy.get("[data-testid=split-talk] .cm-content").should("contain", embed);
      cy.get("[data-testid=split-talk] .cm-embed-box").should(
        "contain",
        "Joy from the drawer.",
      );
      cy.wait(1000);
      storedText("Talk on endurance").should(
        "contain",
        `Ro 15:5 calls God the one who supplies endurance.\n\n${embed}`,
      );
      // Not placed: no card, and the drawer row is not marked as on the Board.
      cy.get("[data-testid=board-canvas]").should(
        "not.contain",
        "Joy from the drawer.",
      );
      cy.docByTitle("Talk on endurance").then((talk) => {
        cy.bridge<{ nodes: { file?: string }[] } | null>("get_board", {
          id: talk.id,
        }).then((board) => {
          expect((board?.nodes ?? []).map((n) => n.file)).not.to.include(summary.path);
        });
      });
    });
  });

  it("drags a Vault search result from the drawer in as a link", () => {
    // No shared Tag or Passage, so it is reached only by the drawer's search.
    cy.bridge<{ summary: { id: string } }>("create_document", {
      docType: "note",
      title: "Drawer searched note",
      fields: {},
      body: "",
    }).then(({ summary }) => {
      cy.openApp();
      openSplit();
      cy.get("[data-testid=board-drawer-open]").click();
      cy.get("[data-testid=board-drawer] input").type("Drawer searched");
      cy.get(drawerRow(summary.id)).should("have.attr", "draggable", "true");
      dragRowOntoLine(
        drawerRow(summary.id),
        "Jas 1:2 sounds impossible",
        "[data-testid=split-talk]",
      );
      cy.get("[data-testid=split-talk] .cm-content").should(
        "contain",
        "[[Drawer searched note]]",
      );
      cy.wait(1000);
      storedText("Talk on endurance").then((text) => {
        const line = text
          .split("\n")
          .find((l) => l.includes("[[Drawer searched note]]"));
        expect(line).to.contain("sounds impossible");
      });
      cy.get("[data-testid=board-canvas]").should(
        "not.contain",
        "Drawer searched note",
      );
      // A click still places it.
      cy.get(drawerRow(summary.id)).click();
      cy.get("[data-testid=board-canvas]").should(
        "contain",
        "Drawer searched note",
      );
    });
  });

  it("does not let drawer rows drag while Reading mode is on", () => {
    openSplit();
    cy.get("[data-testid=board-drawer-open]").click();
    cy.get("[data-testid=board-drawer-row] button")
      .first()
      .should("have.attr", "draggable", "true");
    cy.get("[data-testid=reading-toggle]").click();
    cy.get("[data-testid=board-drawer-row] button[draggable=true]").should(
      "not.exist",
    );
    cy.get("[data-testid=reading-toggle]").click();
  });

  it("does not let drawer rows drag with the Board alone on screen", () => {
    // No text beside it to drop into: a row only places, by its click.
    cy.openDoc("Talk on endurance");
    cy.get("[data-testid=tab-board]").click();
    cy.get("[data-testid=board-drawer-row] button").should("have.length.at.least", 1);
    cy.get("[data-testid=board-drawer-row] button[draggable=true]").should(
      "not.exist",
    );
  });
});
