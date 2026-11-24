// Candidates on a Composition: shared material the Composition does not yet
// link, versus material it already links, embeds or tags ("Used").

/** The stored text of a document. */
function storedText(title: string) {
  return cy.docByTitle(title).then((d) => cy.task<string>("file:read", `${Cypress.env("vault")}/${d.path}`));
}

/** A Candidate row's button in the panel, by document id. */
const candidateRow = (id: string) =>
  `[data-testid=right-panel] [data-testid=candidate][data-doc="${id}"] [data-testid=candidate-open]`;

/**
 * Drag a Candidate row onto the editor line holding `line`, the way the
 * browser would: one DataTransfer from `dragstart` to `dragend` (spec #202).
 */
function dragOntoLine(id: string, line: string) {
  const data = new DataTransfer();
  cy.get(candidateRow(id)).trigger("dragstart", { dataTransfer: data });
  cy.get(candidateRow(id)).should("have.attr", "data-dragging", "true");
  cy.contains(".cm-line", line).trigger("dragover", { dataTransfer: data });
  cy.contains(".cm-line", line).trigger("drop", { dataTransfer: data });
  cy.get(candidateRow(id)).trigger("dragend", { dataTransfer: data });
  cy.get(candidateRow(id)).should("not.have.attr", "data-dragging");
}

const undoKey = Cypress.platform === "darwin" ? "{cmd}z" : "{ctrl}z";
describe("Candidates", () => {
  beforeEach(() => cy.openApp());

  it("splits Candidates from material already used in the Composition", () => {
    cy.openDoc("Talk on endurance");
    // The demo Board holds "Endurance in trials", so it is placed rather than
    // untouched: a third state between Candidate and used (PLAN §17.6).
    cy.get("[data-testid=right-panel] [data-testid=candidates]")
      .parent()
      .should("not.contain", "Endurance in trials");
    cy.get("[data-testid=right-panel]")
      .contains("button", "On the Board")
      .then(($b) => {
        if ($b.attr("data-state") !== "open") cy.wrap($b).click();
      });
    cy.get("[data-testid=right-panel] [data-testid=on-board]")
      .parent()
      .should("contain", "Endurance in trials");
    // The Clipping is embedded: used, not a Candidate. It shows its own
    // words, having no title (ADR 0013).
    cy.get("[data-testid=right-panel] [data-testid=candidates]")
      .parent()
      .should("not.contain", "Endurance is not merely putting up");
    cy.get("[data-testid=right-panel]")
      .contains("Used in this Composition")
      .click();
    cy.get("[data-testid=right-panel] [data-testid=used-material]")
      .parent()
      .should("contain", "Endurance is not merely putting up");
  });

  // PLAN §17.10: the panel puts material on the Board without opening it,
  // and the Candidate moves to "On the Board", still unused.
  it("places a Candidate on the Board from the panel", () => {
    // The tests after this one expect this Candidate untouched, so the Board
    // is put back at the end.
    cy.docByTitle("Talk on endurance").then((talk) => {
      cy.bridge("get_board", { id: talk.id }).as("originalBoard");
    });
    cy.openDoc("Talk on endurance");
    cy.get("[data-testid=right-panel] [data-testid=candidates]")
      .parent()
      .contains("[data-testid=candidate]", "Undeserved kindness in Romans")
      .find("[data-testid=candidate-place]")
      .click();
    cy.get("[data-testid=right-panel] [data-testid=candidates]")
      .parent()
      .should("not.contain", "Undeserved kindness in Romans");
    cy.get("[data-testid=right-panel]")
      .contains("button", "On the Board")
      .then(($b) => {
        if ($b.attr("data-state") !== "open") cy.wrap($b).click();
      });
    cy.get("[data-testid=right-panel] [data-testid=on-board]")
      .parent()
      .should("contain", "Undeserved kindness in Romans");
    // It is a card on the Board file, not a Mention in the talk.
    cy.docByTitle("Undeserved kindness in Romans").then((note) => {
      cy.docByTitle("Talk on endurance").then((talk) => {
        cy.task<string>("file:read", `${Cypress.env("vault")}/${talk.path.replace(/\.md$/, ".canvas")}`).then((text) => {
          expect(text).to.contain(note.path);
        });
        cy.task<string>("file:read", `${Cypress.env("vault")}/${talk.path}`).then((text) => {
          expect(text).not.to.contain("Undeserved kindness in Romans");
        });
      });
    });
    // And the Board, opened, shows the card.
    cy.get("[data-testid=tab-board]").click();
    cy.get("[data-testid=board-canvas]").should("contain", "Undeserved kindness in Romans");
    cy.get("[data-testid=tab-talk]").click();
    cy.docByTitle("Talk on endurance").then((talk) => {
      cy.get("@originalBoard").then((board) => cy.bridge("save_board", { id: talk.id, board }));
    });
  });

  it("offers no place button while Reading mode is on", () => {
    cy.openDoc("Talk on endurance");
    cy.get("[data-testid=reading-toggle]").click();
    cy.get("[data-testid=candidate-place]").should("not.exist");
    cy.get("[data-testid=reading-toggle]").click();
    cy.get("[data-testid=candidate-place]").should("exist");
  });

  it("Home counts only unused Candidates", () => {
    cy.docByTitle("Talk on endurance").then((d) => {
      cy.query<{ items: { used: boolean }[]; unused_total: number }>({ kind: "candidates", id: d.id }).then((c) => {
        // Material on the Board still counts: it is not used until the prose
        // says so, which is what the Home count is about.
        const unused = c.items.filter((x) => !x.used).length;
        expect(c.unused_total).to.equal(unused);
        expect(
          c.items.some((x) => x.used),
          "demo vault has used material",
        ).to.be.true;
        cy.get("[data-testid=home-progress]")
          .contains("Talk on endurance")
          .parents("li")
          .should("contain", `${unused} candidate`);
      });
    });
  });

  it("says how many Candidates there are when the list is cut at 50", () => {
    // Under the limit the panel is as it always was.
    cy.openDoc("Talk on endurance");
    cy.get("[data-testid=right-panel] [data-testid=candidate]").should("exist");
    cy.get("[data-testid=candidates-more]").should("not.exist");
    // A Composition of its own, with a Tag nothing in the demo Vault uses, so
    // the 55 Notes sharing it change no other test's Candidates.
    cy.bridge("create_document", {
      docType: "composition",
      title: "Overflow talk",
      fields: { tags: ["cyoverflow"] },
      body: "",
    });
    Cypress._.times(55, (i) => {
      cy.bridge("create_document", {
        docType: "note",
        title: `Overflow note ${String(i).padStart(2, "0")}`,
        fields: { tags: ["cyoverflow"] },
        body: "",
      });
    });
    cy.openApp();
    // Home counts all 55 unused Candidates, not the 50 the list holds.
    cy.get("[data-testid=home-progress]")
      .contains("Overflow talk")
      .parents("li")
      .should("contain", "55 candidates");
    cy.openDoc("Overflow talk");
    cy.get("[data-testid=right-panel] [data-testid=candidate]").should("have.length", 50);
    cy.get("[data-testid=right-panel] [data-testid=candidates-more]").should(
      "contain",
      "Showing 50 of 55",
    );
  });

  it("linking a Candidate from the Composition moves it to Used", () => {
    cy.openDoc("Talk on endurance");
    // A Candidate that is neither used nor on the Board, so the move it makes
    // is the prose link and nothing else.
    cy.get("[data-testid=right-panel] [data-testid=candidates]")
      .parent()
      .should("contain", "Undeserved kindness in Romans");
    cy.get(".cm-content").click().type("{ctrl}{end}");
    cy.get(".cm-content").type("{enter}See also ");
    cy.get(".cm-content").type("[[Undeserved kindness in Romans]]");
    cy.get("body").type("{esc}");
    // The panel re-queries once the edit is saved.
    cy.get("[data-testid=right-panel] [data-testid=candidates]")
      .parent()
      .should("not.contain", "Undeserved kindness in Romans");
    cy.get("[data-testid=right-panel]")
      .contains("Used in this Composition")
      .click();
    cy.get("[data-testid=right-panel] [data-testid=used-material]")
      .parent()
      .should("contain", "Undeserved kindness in Romans");
  });

  // Spec #202: material on screen is pulled into the sentence by dragging it.
  it("drags a Clipping Candidate into the text as an Embed with its Citation", () => {
    cy.bridge<{ summary: { id: string; path: string } }>("create_document", {
      docType: "clipping",
      // A Clipping has no title (ADR 0013): its file is named by its Citation.
      title: "",
      fields: { source: "[[Keep Enduring with Joy]]", locator: "par. 4", tags: ["endurance"] },
      body: "> Joy is a quality of the heart.\n",
    }).then(({ summary }) => {
      const stem = summary.path.replace(/\.md$/, "").split("/").pop();
      const embed = `![[${stem}|Keep Enduring with Joy · par. 4]]`;
      cy.openApp();
      cy.openDoc("Talk on endurance");
      cy.get("[data-testid=right-panel] [data-testid=candidates]")
        .parent()
        .find(candidateRow(summary.id))
        .should("have.attr", "draggable", "true");
      dragOntoLine(summary.id, "Ro 15:5 calls God");
      // On a line of its own after the line it was dropped on, selected, and
      // drawn live below it.
      cy.get(".cm-content").should("contain", embed);
      cy.window().then((win) => {
        expect(win.getSelection()?.toString()).to.equal(embed);
      });
      cy.get(".cm-embed-box").should("contain", "Joy is a quality of the heart.");
      cy.wait(1000);
      storedText("Talk on endurance").should(
        "contain",
        `Ro 15:5 calls God the one who supplies endurance.\n\n${embed}`,
      );
      // Saved, the Clipping is used.
      cy.get("[data-testid=right-panel] [data-testid=candidates]")
        .parent()
        .find(`[data-doc="${summary.id}"]`)
        .should("not.exist");
      cy.get("[data-testid=right-panel]")
        .contains("Used in this Composition")
        .click();
      cy.get("[data-testid=right-panel] [data-testid=used-material]")
        .parent()
        .find(`[data-doc="${summary.id}"]`)
        .should("exist");
    });
  });

  it("drags a Note Candidate in as an inline link, and one Undo removes it", () => {
    cy.bridge<{ summary: { id: string } }>("create_document", {
      docType: "note",
      title: "Dragged note",
      fields: { tags: ["endurance"] },
      body: "",
    }).then(({ summary }) => {
      cy.openApp();
      cy.openDoc("Talk on endurance");
      dragOntoLine(summary.id, "Jas 1:2 sounds impossible");
      cy.get(".cm-content").should("contain", "[[Dragged note]]");
      cy.get(".cm-content").should("not.contain", "![[Dragged note");
      cy.window().then((win) => {
        expect(win.getSelection()?.toString()).to.equal("[[Dragged note]]");
      });
      cy.wait(1000);
      // Inline, on the line it was dropped on.
      storedText("Talk on endurance").then((text) => {
        const line = text.split("\n").find((l) => l.includes("[[Dragged note]]"));
        expect(line).to.contain("sounds impossible");
      });
      cy.focused().type(undoKey);
      cy.get(".cm-content").should("not.contain", "Dragged note");
      cy.wait(1000);
      storedText("Talk on endurance").should("not.contain", "Dragged note");
      // Still a Candidate, dragged from the panel the same way again.
      cy.get(candidateRow(summary.id)).should("exist");
    });
  });
});
