// Candidates on a Composition: shared material the Composition does not yet
// link, versus material it already links, embeds or tags ("Used").
import { dragRowOntoLine, storedText } from "../support/drag";

/** A Candidate row's button in the panel, by document id. */
const candidateRow = (id: string) =>
  `[data-testid=right-panel] [data-testid=candidate][data-doc="${id}"] [data-testid=candidate-open]`;

/** Drag a Candidate row from the panel onto the editor line holding `line`. */
const dragOntoLine = (id: string, line: string) => dragRowOntoLine(candidateRow(id), line);

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

  // Spec #205: the demo talk draws on "Keep Enduring with Joy", and its par. 15
  // Clipping shares neither a Tag nor a Passage with the talk.
  it("lists a Clipping that comes in only through a Source, with its reason", () => {
    cy.openDoc("Talk on endurance");
    cy.get("[data-testid=right-panel] [data-testid=candidates]")
      .parent()
      .contains("[data-testid=candidate]", "Joy does not wait for the trial to end")
      .as("row");
    cy.get("@row")
      .find("[data-testid=candidate-from-source]")
      .should("have.length", 1)
      .and("contain", "Keep Enduring with Joy");
    // Dragging still works on a row that came in this way.
    cy.get("@row").find("[data-testid=candidate-open]").should("have.attr", "draggable", "true");
  });

  // Spec #205: the Sources row. Its own Composition and Source, so the
  // demo talk's Candidates, which the other tests count on, never change.
  it("attaches a Source from the Sources row, and removing it takes its Clippings away", () => {
    const row = "[data-testid=right-panel] [data-testid=sources-row]";
    cy.bridge("create_document", { docType: "composition", title: "Sourced talk", fields: { tags: ["cysourced"] }, body: "Opening words.\n" });
    cy.bridge<{ summary: { id: string } }>("create_document", { docType: "source", title: "Cy Source Book", fields: { kind: "book" }, body: "" }).then(({ summary: book }) => {
      cy.bridge("create_document", { docType: "source", title: "Cy Other Source", fields: { kind: "article" }, body: "" });
      cy.bridge<{ summary: { id: string } }>("create_document", {
        docType: "clipping",
        title: "",
        fields: { source: "[[Cy Source Book]]", locator: "p. 7" },
        body: "> Words kept from the cy book.\n",
      }).then(({ summary: clip }) => {
        cy.openApp();
        cy.openDoc("Sourced talk");
        // The text below the front matter, which attaching never touches.
        const bodyOf = (text: string) => text.slice(text.indexOf("\n---", 3));
        storedText("Sourced talk").then(bodyOf).as("before");
        // Empty: the button and its hint, and no Candidate from the book.
        cy.get(`${row} [data-testid=sources-row-hint]`).should("be.visible");
        cy.get(`${row} [data-testid=source-chip]`).should("not.exist");
        cy.get(`[data-testid=right-panel] [data-testid=candidate][data-doc="${clip.id}"]`).should("not.exist");
        // The picker offers Sources only.
        cy.get(`${row} [data-testid=add-source]`).click();
        cy.get("[data-testid=add-source-dialog]").should("be.visible");
        cy.get("[data-testid=add-source-input]").type("Cy");
        cy.get("[data-testid=picker-option]").should("have.length.greaterThan", 0);
        cy.get(`[data-testid=picker-option][data-id="${clip.id}"]`).should("not.exist");
        cy.contains("[data-testid=picker-option]", "Cy Source Book").click();
        cy.get("[data-testid=add-source-dialog]").should("not.exist");
        cy.get(`${row} [data-testid=source-chip][data-doc="${book.id}"]`).should("contain", "Cy Source Book");
        cy.get(`${row} [data-testid=sources-row-hint]`).should("not.exist");
        cy.wait(1000);
        storedText("Sourced talk").should("contain", 'sources: ["[[Cy Source Book]]"]');
        // What cites the book is a Candidate now, saying where it came from.
        cy.get(`[data-testid=right-panel] [data-testid=candidate][data-doc="${clip.id}"]`)
          .find("[data-testid=candidate-from-source]")
          .should("contain", "Cy Source Book");
        // An attached Source is not offered again.
        cy.get(`${row} [data-testid=add-source]`).click();
        cy.get("[data-testid=add-source-input]").type("Cy");
        cy.contains("[data-testid=picker-option]", "Cy Other Source").should("exist");
        cy.get(`[data-testid=picker-option][data-id="${book.id}"]`).should("not.exist");
        cy.get("[data-testid=add-source-input]").type("{esc}");
        cy.get("[data-testid=add-source-dialog]").should("not.exist");
        // Removing the chip takes the Source out of the Property, and its
        // Clipping out of the panel; the text is as it was.
        cy.get(`${row} [data-testid=source-chip][data-doc="${book.id}"] [data-testid=source-chip-remove]`).click();
        cy.get(`${row} [data-testid=source-chip]`).should("not.exist");
        cy.get(`[data-testid=right-panel] [data-testid=candidate][data-doc="${clip.id}"]`).should("not.exist");
        cy.wait(1000);
        cy.get<string>("@before").then((before) => storedText("Sourced talk").then(bodyOf).should("equal", before));
      });
    });
  });

  it("shows an entry that is not a Source as a struck-through chip, still removable", () => {
    cy.bridge("create_document", {
      docType: "composition",
      title: "Loosely sourced talk",
      fields: { sources: ["[[Undeserved kindness in Romans]]", "[[A Source long gone]]"] },
      body: "",
    });
    cy.openApp();
    cy.openDoc("Loosely sourced talk");
    const row = "[data-testid=right-panel] [data-testid=sources-row]";
    cy.get(`${row} [data-testid=source-chip-unresolved]`).should("have.length", 2);
    cy.get(`${row} [data-testid=source-chip-unresolved]`)
      .first()
      .should("contain", "Undeserved kindness in Romans")
      .find("[data-testid=source-chip-hint]")
      .should("contain", "Not a Source in this Vault");
    cy.get(`${row} [data-testid=source-chip-unresolved] .line-through`).should("have.length", 2);
    // The panel still loads.
    cy.get("[data-testid=right-panel] [data-testid=candidates]").should("exist");
    cy.get(`${row} [data-testid=source-chip-unresolved]`)
      .contains("A Source long gone")
      .parents("[data-testid=source-chip-unresolved]")
      .find("[data-testid=source-chip-remove]")
      .click();
    cy.get(`${row} [data-testid=source-chip-unresolved]`).should("have.length", 1);
    cy.wait(1000);
    storedText("Loosely sourced talk")
      .should("contain", "Undeserved kindness in Romans")
      .and("not.contain", "A Source long gone");
  });

  it("shows the Sources chips without Add or remove while Reading mode is on", () => {
    cy.openDoc("Talk on endurance");
    const row = "[data-testid=right-panel] [data-testid=sources-row]";
    cy.get(`${row} [data-testid=source-chip]`).should("contain", "Keep Enduring with Joy");
    cy.get(`${row} [data-testid=add-source]`).should("exist");
    cy.get(`${row} [data-testid=source-chip-remove]`).should("exist");
    cy.get("[data-testid=reading-toggle]").click();
    cy.get(`${row} [data-testid=source-chip]`).should("contain", "Keep Enduring with Joy");
    cy.get(`${row} [data-testid=add-source]`).should("not.exist");
    cy.get(`${row} [data-testid=source-chip-remove]`).should("not.exist");
    cy.get("[data-testid=reading-toggle]").click();
    cy.get(`${row} [data-testid=add-source]`).should("exist");
  });

  it("has no Sources row on a Note", () => {
    cy.openDoc("Undeserved kindness in Romans");
    cy.get("[data-testid=right-panel]").should("exist");
    cy.get("[data-testid=sources-row]").should("not.exist");
    cy.get("[data-testid=add-source]").should("not.exist");
  });

  // Spec #205: the palette's Add Source opens the Sources row's picker, on
  // its own Composition so the demo talk's Candidates stay as they are.
  it("offers Add Source in the palette on a Composition, opening the Sources picker", () => {
    const row = "[data-testid=right-panel] [data-testid=sources-row]";
    cy.bridge("create_document", { docType: "composition", title: "Palette sourced talk", fields: { tags: ["cypalette"] }, body: "Opening words.\n" });
    cy.openApp();
    cy.openDoc("Palette sourced talk");
    cy.get(`${row} [data-testid=source-chip]`).should("not.exist");
    cy.runCommand("Add Source");
    cy.get("[data-testid=add-source-dialog]").should("be.visible");
    cy.get("[data-testid=add-source-input]").type("Morning Worship");
    cy.contains("[data-testid=picker-option]", "Morning Worship 2024-05-14").click();
    cy.get("[data-testid=add-source-dialog]").should("not.exist");
    cy.get(`${row} [data-testid=source-chip]`).should("have.length", 1).and("contain", "Morning Worship 2024-05-14");
    // Its Clipping (1 Cor 13, #love) shares nothing with this talk.
    cy.get('[data-testid=right-panel] [data-testid=candidate][data-doc="01M26CD0EEXFE0PK4AMKDQEJXE"]')
      .find("[data-testid=candidate-from-source]")
      .should("contain", "Morning Worship 2024-05-14");
    cy.wait(1000);
    storedText("Palette sourced talk").should("contain", 'sources: ["[[Morning Worship 2024-05-14]]"]');
  });

  it("offers no Add Source in the palette on a Note, nor while Reading mode is on", () => {
    cy.openDoc("Undeserved kindness in Romans");
    cy.palette(">Add Source");
    cy.get("[data-testid=palette]").should("not.contain", "Add Source");
    cy.get("body").type("{esc}");
    cy.openDoc("Talk on endurance");
    cy.palette(">Add Source");
    cy.get("[data-testid=palette] [cmdk-item]").should("contain", "Add Source");
    cy.get("body").type("{esc}");
    cy.get("[data-testid=reading-toggle]").click();
    cy.palette(">Add Source");
    cy.get("[data-testid=palette]").should("not.contain", "Add Source");
    cy.get("body").type("{esc}");
    cy.get("[data-testid=reading-toggle]").click();
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

  it("drags a used Clipping in again from Used, as a second reference", () => {
    cy.bridge<{ summary: { id: string; path: string } }>("create_document", {
      docType: "clipping",
      title: "",
      fields: { source: "[[Keep Enduring with Joy]]", locator: "par. 6", tags: ["endurance"] },
      body: "> Joy twice over.\n",
    }).then(({ summary }) => {
      const stem = summary.path.replace(/\.md$/, "").split("/").pop();
      const embed = `![[${stem}|Keep Enduring with Joy · par. 6]]`;
      const count = (text: string) => text.split(embed).length - 1;
      cy.openApp();
      cy.openDoc("Talk on endurance");
      dragOntoLine(summary.id, "Ro 15:5 calls God");
      cy.wait(1000);
      storedText("Talk on endurance").then((text) => expect(count(text)).to.equal(1));
      // Saved, it is listed under Used, and its row there drags the same way.
      cy.get("[data-testid=right-panel]").contains("Used in this Composition").click();
      cy.get("[data-testid=right-panel] [data-testid=used-material]")
        .parent()
        .find(candidateRow(summary.id))
        .should("have.attr", "draggable", "true");
      dragOntoLine(summary.id, "Jas 1:2 sounds impossible");
      cy.wait(1000);
      storedText("Talk on endurance").then((text) => expect(count(text)).to.equal(2));
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
  // Spec #202: the drag lands only in its own Composition's text.
  it("makes no row draggable while Reading mode is on", () => {
    cy.openDoc("Talk on endurance");
    cy.get("[data-testid=right-panel] [data-testid=candidate-open]")
      .first()
      .should("have.attr", "draggable", "true");
    cy.get("[data-testid=reading-toggle]").click();
    cy.get("[data-testid=right-panel] [data-testid=candidate-open]").should("exist");
    cy.get("[data-testid=right-panel] [data-testid=candidate-open][draggable]").should("not.exist");
    cy.get("[data-testid=reading-toggle]").click();
    cy.get("[data-testid=right-panel] [data-testid=candidate-open]")
      .first()
      .should("have.attr", "draggable", "true");
  });

  it("opens a row on a click, never on a drag", () => {
    cy.bridge<{ summary: { id: string } }>("create_document", {
      docType: "note",
      title: "Clicked note",
      fields: { tags: ["endurance"] },
      body: "",
    }).then(({ summary }) => {
      cy.openApp();
      cy.openDoc("Talk on endurance");
      // A drag that ends where it started, and the click the browser may
      // send after it: the Composition stays open.
      const data = new DataTransfer();
      cy.get(candidateRow(summary.id)).trigger("dragstart", { dataTransfer: data });
      cy.get(candidateRow(summary.id)).trigger("dragend", { dataTransfer: data });
      cy.get(candidateRow(summary.id)).trigger("click");
      cy.get("[data-testid=doc-title]").should("have.value", "Talk on endurance");
      // A plain click opens it.
      cy.get(candidateRow(summary.id)).click();
      cy.get("[data-testid=doc-title]").should("have.value", "Clicked note");
    });
  });

  it("inserts nothing when dropped into another Pane's Note, and shows no drop cursor there", () => {
    const pane = (i: 0 | 1) => `[data-testid=pane][data-pane=${i}]`;
    cy.bridge<{ summary: { id: string } }>("create_document", {
      docType: "note",
      title: "Stray note",
      fields: { tags: ["endurance"] },
      body: "",
    }).then(({ summary }) => {
      cy.openApp();
      cy.openDoc("Talk on endurance");
      cy.runCommand("Open in other Pane");
      cy.get("[data-testid=panes]").should("have.attr", "data-count", "2");
      // The palette opens in the last-used Pane: the right one.
      cy.openDoc("Undeserved kindness in Romans");
      cy.get(`${pane(1)} [data-testid=doc-title]`).should("have.value", "Undeserved kindness in Romans");
      // The side panel follows the last-used Pane: the talk's Candidates.
      cy.get(`${pane(0)} .cm-content`).click();
      cy.docByTitle("Talk on endurance").then((talk) => {
        cy.get("[data-testid=right-panel]").should("have.attr", "data-doc", talk.id);
      });
      storedText("Undeserved kindness in Romans").then((before) => {
        const data = new DataTransfer();
        const line = () => cy.contains(`${pane(1)} .cm-line`, "Eph 2:8 says the same");
        cy.get(candidateRow(summary.id)).trigger("dragstart", { dataTransfer: data });
        line().trigger("dragover", { dataTransfer: data });
        cy.get(`${pane(1)} .cm-dropCursor:visible`).should("not.exist");
        line().trigger("drop", { dataTransfer: data });
        cy.get(candidateRow(summary.id)).trigger("dragend", { dataTransfer: data });
        cy.wait(1000);
        cy.get(`${pane(1)} .cm-content`).should("not.contain", "Stray note");
        cy.get(`${pane(0)} .cm-content`).should("not.contain", "Stray note");
        storedText("Undeserved kindness in Romans").should("equal", before);
      });
      cy.get(`${pane(1)} [data-testid=pane-close]`).click();
      cy.get("[data-testid=panes]").should("have.attr", "data-count", "1");
    });
  });

  it("inserts nothing, and raises no error, when the document is deleted during the drag", () => {
    cy.bridge<{ summary: { id: string } }>("create_document", {
      docType: "note",
      title: "Vanishing note",
      fields: { tags: ["endurance"] },
      body: "",
    }).then(({ summary }) => {
      cy.openApp();
      cy.openDoc("Talk on endurance");
      storedText("Talk on endurance").then((before) => {
        const data = new DataTransfer();
        const line = () => cy.contains(".cm-line", "Ro 15:5 calls God");
        cy.get(candidateRow(summary.id)).trigger("dragstart", { dataTransfer: data });
        cy.bridge("delete_document", { id: summary.id });
        line().trigger("dragover", { dataTransfer: data });
        line().trigger("drop", { dataTransfer: data });
        cy.wait(1000);
        cy.get(".cm-content").should("not.contain", "Vanishing note");
        storedText("Talk on endurance").should("equal", before);
      });
    });
  });
});
