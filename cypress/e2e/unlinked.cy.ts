/**
 * Unlinked mentions and Linkables (ADR 0011): the two ends of the same
 * question. A Hub lists documents that write its name without linking it; a
 * document being written lists the names it could link.
 */
describe("Unlinked mentions", () => {
  beforeEach(() => {
    cy.openApp();
  });

  it("lists prose that names the Hub without linking it", () => {
    cy.openDoc("Antioch");
    cy.get("[data-testid=unlinked-mentions]")
      .should("exist")
      .and("contain", "The brothers at Antioch");
    // The excerpt shows the sentence it was found in.
    cy.get("[data-testid=unlinked-mentions]").should(
      "contain",
      "first called Christians",
    );
  });

  it("keeps Unlinked mentions and Backlinks disjoint", () => {
    // "Paul in Ephesus" writes [[Ephesus]], so it is a Backlink there and must
    // not also be offered as an Unlinked mention.
    cy.openDoc("Ephesus");
    cy.get("[data-testid=backlinks]").should("contain", "Paul in Ephesus");
    cy.get("[data-testid=unlinked-mentions]").should(
      "not.contain",
      "Paul in Ephesus",
    );
  });

  it("links one occurrence, then Undo puts the words back", () => {
    // One test for the round trip: the specs share a vault, so linking and
    // undoing in the same test leaves it as it was found.
    cy.docByTitle("The brothers at Antioch").then((note) => {
      cy.openDoc("Antioch");
      cy.get("[data-testid=unlinked-mentions]")
        .find("button[aria-label^='Link:']")
        .first()
        .click();

      // The document now links, so it leaves the list and joins Backlinks.
      cy.get("[data-testid=unlinked-mentions]", { timeout: 10000 }).should(
        "not.contain",
        "The brothers at Antioch",
      );
      cy.get("[data-testid=backlinks]").should(
        "contain",
        "The brothers at Antioch",
      );

      // The prose is unchanged apart from the brackets.
      cy.bridge<{ text: string }>("get_document", { id: note.id }).then((d) => {
        expect(d.text).to.contain("[[Antioch]] is where the disciples");
        expect(d.text).to.contain("first called Christians");
      });

      cy.contains("button", "Undo").click();
      cy.get("[data-testid=unlinked-mentions]", { timeout: 10000 }).should(
        "contain",
        "The brothers at Antioch",
      );
      cy.bridge<{ text: string }>("get_document", { id: note.id }).then((d) => {
        expect(d.text).to.contain("Antioch is where the disciples");
        expect(d.text).to.not.contain("[[Antioch]] is where");
      });
    });
  });

  it("shows no section on a Scripture page", () => {
    // A Passage is already a Mention, so Scripture has none by construction —
    // and the Book "John" shares its name with a Character.
    cy.openDoc("Ephesus");
    cy.get("[data-testid=unlinked-mentions]").should("exist");
    cy.runCommand("Open a Passage");
    cy.get("[data-testid=goto-passage] input").type("John 3:16");
    cy.get("[data-testid=goto-passage]").contains("button", "Open").click();
    cy.hubTitle("John 3:16");
    cy.get("[data-testid=unlinked-mentions]").should("not.exist");
  });
});

describe("Linkables", () => {
  beforeEach(() => {
    cy.openApp();
  });

  it("lists names the open document could link, one row per target", () => {
    cy.openDoc("The brothers at Antioch");
    // "Saul" is an alias of Paul, and the note writes it twice: one row,
    // counted, not two rows.
    cy.get("[data-testid=linkables]")
      .parent()
      .should("contain", "Paul")
      .and("contain", "2×")
      .and("contain", "Troas");
  });

  it("does not offer a name inside a heading", () => {
    // The note names Antioch, Saul (an alias of Paul) and Troas in its prose.
    // Its H1 repeats the title, and a heading is structure rather than prose,
    // so it adds no fourth row.
    cy.openDoc("The brothers at Antioch");
    cy.get("[data-testid=linkables]").should("exist");
    cy.get("[data-testid=linkables]")
      .parent()
      .find("button[aria-label^='Link:']")
      .should("have.length", 3);
  });

  it("selects the occurrence when the row's label is clicked", () => {
    // The label reveals, the icon links: two behaviours on one row, and they
    // must agree about which words they mean.
    cy.openDoc("The brothers at Antioch");
    cy.get("[data-testid=linkables]")
      .parent()
      .contains("button", "Troas")
      .click();
    cy.window().then((win) => {
      expect(String(win.getSelection())).to.equal("Troas");
    });
  });

  it("selects the same words the icon would link, for every row", () => {
    // Both actions resolve the position through one function; this is the
    // assertion that keeps them from drifting apart again.
    cy.openDoc("The brothers at Antioch");
    cy.get("[data-testid=linkables]")
      .parent()
      .find("li")
      .each(($li) => {
        const title = $li.find("button").first().text();
        // The row shows the matched text in quotes when it differs from the
        // title; otherwise the title is what was matched.
        const quoted = /[“"]([^”"]+)[”"]/.exec(title);
        const expected = quoted ? quoted[1] : title.replace(/\d+×$/, "");
        cy.wrap($li).find("button").first().click();
        cy.window().then((win) => {
          expect(String(win.getSelection())).to.equal(expected);
        });
      });
  });

  it("leaves the file's line endings alone", () => {
    // The panel works in the editor's text, which is LF whatever the file is.
    // Writing that back must not quietly convert a CRLF document.
    cy.docByTitle("The brothers at Antioch").then((note) => {
      cy.bridge<{ text: string }>("get_document", { id: note.id }).then(
        (before) => {
          // Written here rather than assumed: whether the checkout is CRLF
          // depends on the machine's git settings.
          const crlf = before.text.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
          cy.bridge("save_document", { id: note.id, text: crlf });
          cy.openApp();
          cy.openDoc("The brothers at Antioch");
          cy.get("button[aria-label='Link: Troas']", { timeout: 10000 }).click();
          cy.get("[data-testid=save-status]", { timeout: 10000 }).should(
            "have.attr",
            "data-status",
            "saved",
          );
          cy.bridge<{ text: string }>("get_document", { id: note.id }).then(
            (after) => {
              expect(after.text).to.contain("[[Troas]]");
              expect(after.text, "still CRLF").to.contain("\r\n");
            },
          );
          cy.bridge("save_document", { id: note.id, text: before.text });
        },
      );
    });
  });

  it("follows the text as it is typed", () => {
    // The list is built from the body the panel is holding. When that was kept
    // only in a ref, it stayed as the document loaded: typing a new name added
    // no row, and the list went stale the moment writing began.
    cy.docByTitle("The brothers at Antioch").then((note) => {
      cy.bridge<{ text: string }>("get_document", { id: note.id }).then(
        (before) => {
          cy.openDoc("The brothers at Antioch");
          cy.get("[data-testid=linkables]")
            .parent()
            .should("not.contain", "Ephesus");
          cy.get(".cm-content").click("bottom").type("\nEphesus was next.");
          cy.get("[data-testid=linkables]", { timeout: 10000 })
            .parent()
            .should("contain", "Ephesus");
          cy.bridge("save_document", { id: note.id, text: before.text });
        },
      );
    });
  });

  it("updates the open editor when a row is linked", () => {
    // Linking writes through the panel, which the editor only picks up on a
    // revision bump. Without one the brackets reached the file but not the
    // page, so the link appeared only after a reload.
    cy.docByTitle("The brothers at Antioch").then((note) => {
      cy.bridge<{ text: string }>("get_document", { id: note.id }).then(
        (before) => {
          cy.openDoc("The brothers at Antioch");
          cy.get("button[aria-label='Link: Troas']").click();
          // Asserted on the open page, with no reload in between. Live Preview
          // hides the brackets, so the proof that the link reached the editor
          // is the rendered link itself, not the literal "[[Troas]]".
          cy.get(".cm-content .cm-wikilink")
            .should("have.attr", "data-link", "Troas");
          // And the row is gone, because the name is now linked.
          cy.get("[data-testid=linkables]", { timeout: 10000 })
            .parent()
            .should("not.contain", "Troas");
          cy.get("[data-testid=save-status]", { timeout: 10000 }).should(
            "have.attr",
            "data-status",
            "saved",
          );
          cy.bridge("save_document", { id: note.id, text: before.text });
        },
      );
    });
  });

  it("retires a target once it is linked, however many times it is written", () => {
    // The note writes "Saul" twice, so the row counts 2×. Linking one does not
    // leave a 1× row behind: the decision to link Paul was made, and the
    // second mention stays as prose (ADR 0011).
    cy.docByTitle("The brothers at Antioch").then((note) => {
      cy.bridge<{ text: string }>("get_document", { id: note.id }).then(
        (before) => {
          cy.openDoc("The brothers at Antioch");
          cy.get("[data-testid=linkables]")
            .parent()
            .should("contain", "Paul")
            .and("contain", "2×");
          cy.get("button[aria-label='Link: Paul']").click();
          cy.get("[data-testid=linkables]", { timeout: 10000 })
            .parent()
            .should("not.contain", "Paul");
          cy.get("[data-testid=save-status]", { timeout: 10000 }).should(
            "have.attr",
            "data-status",
            "saved",
          );
          // One link written, the other mention untouched.
          cy.bridge<{ text: string }>("get_document", { id: note.id }).then(
            (after) => {
              expect(after.text.match(/\[\[Paul\|Saul\]\]/g)).to.have.length(1);
              expect(after.text).to.contain("look for Saul");
            },
          );
          cy.bridge("save_document", { id: note.id, text: before.text });
        },
      );
    });
  });

  it("inserts a link that leaves the prose as it was", () => {
    cy.docByTitle("The brothers at Antioch").then((note) => {
      cy.bridge<{ text: string }>("get_document", { id: note.id }).then(
        (before) => {
          cy.openDoc("The brothers at Antioch");
          cy.get("button[aria-label='Link: Troas']").click();
          // The words are unchanged; only the brackets are new.
          // The editor saves on a debounce, so the file is checked through a
          // retrying assertion rather than read once and raced.
          cy.get(".cm-content").should("contain", "comes later in the account");
          cy.get("[data-testid=save-status]", { timeout: 10000 }).should(
            "have.attr",
            "data-status",
            "saved",
          );
          cy.bridge<{ text: string }>("get_document", { id: note.id }).then(
            (after) => {
              expect(after.text).to.contain("[[Troas]] comes later");
            },
          );
          // Put the document back for whatever runs next.
          cy.bridge("save_document", { id: note.id, text: before.text });
        },
      );
    });
  });
});
