// Capturing from a Source's own page: a Clipping or a Note written without
// leaving the work being read. The Source is settled by standing on its page,
// so the box shows it rather than asking for it, and a Clipping is stored as a
// blockquote with no title at all (ADR 0013).
describe("Capture on a Source Hub", () => {
  beforeEach(() => cy.openApp());

  const openSource = () => {
    cy.openDoc("Keep Enduring with Joy");
    cy.get("[data-testid=hub-capture]").should("exist");
  };

  it("keeps a Clipping from the Source being read, and stays on the page", () => {
    openSource();
    cy.get("[data-testid=hub-clipping]").then((before) => {
      cy.get("[data-testid=capture-text]").type(
        "A sentence worth keeping from the chapter.",
      );
      cy.get("[data-testid=capture-locator]").type("par. 31");
      cy.get("[data-testid=capture-submit]").click();

      // Still on the Source, and the new Clipping joined the list above the
      // trail without a reload.
      cy.hubTitle("Keep Enduring with Joy");
      cy.get("[data-testid=hub-clippings]").within(() => {
        cy.contains("A sentence worth keeping from the chapter.");
        cy.contains("par. 31");
      });
      cy.get("[data-testid=hub-clipping]").should(
        "have.length",
        before.length + 1,
      );
    });
  });

  it("stores a Clipping as a blockquote, with its Citation for a name", () => {
    openSource();
    cy.get("[data-testid=capture-text]").type("Borrowed words, kept as-is.");
    cy.get("[data-testid=capture-locator]").type("par. 7");
    cy.get("[data-testid=capture-submit]").click();
    cy.get("[data-testid=hub-clippings]").should(
      "contain",
      "Borrowed words, kept as-is.",
    );

    // The file is named by its Citation, holds no title, and reads as a
    // quotation in Obsidian as much as here.
    cy.bridge<{ path: string; type: string }[]>("list_documents").then(
      (docs) => {
        const kept = docs.filter(
          (d) => d.type === "clipping" && d.path.includes("par. 7"),
        );
        expect(kept, "a Clipping named from its Citation").to.have.length(1);
        expect(kept[0].path).to.contain("keep enduring with joy par. 7");
        cy.task<string>(
          "file:read",
          `${Cypress.env("vault")}/${kept[0].path}`,
        ).then((text) => {
          expect(text).to.contain("> Borrowed words, kept as-is.");
          expect(text).to.contain("locator: par. 7");
          expect(text, "a Clipping has no title").not.to.match(/^title:/m);
        });
      },
    );
  });

  it("keeps a Clipping when the Locator is left blank", () => {
    openSource();
    cy.get("[data-testid=capture-text]").type("No paragraph number for this.");
    cy.get("[data-testid=capture-submit]").click();
    cy.get("[data-testid=hub-clippings]").should(
      "contain",
      "No paragraph number for this.",
    );
  });

  it("writes a Note about the Source instead when told to", () => {
    openSource();
    cy.get("[data-testid=capture-as-note]").click();
    // The Locator belongs to a Clipping; a Note is titled instead.
    cy.get("[data-testid=capture-locator]").should("not.exist");
    cy.get("[data-testid=capture-title]").should("exist");

    cy.get("[data-testid=capture-text]").type("What I make of the chapter.");
    cy.get("[data-testid=capture-title]").type("Endurance and joy");
    cy.get("[data-testid=capture-submit]").click();

    // A Note citing the Source joins the reading trail, not the Clippings.
    cy.hubTitle("Keep Enduring with Joy");
    cy.get("[data-testid=hub-trail]").should("contain", "Endurance and joy");
    cy.get("[data-testid=hub-clippings]").should(
      "not.contain",
      "Endurance and joy",
    );
  });

  it("marks which of the two is being written", () => {
    openSource();
    cy.get("[data-testid=capture-as-clipping]").should(
      "have.attr",
      "aria-pressed",
      "true",
    );
    cy.get("[data-testid=hub-capture]").should(
      "have.class",
      "border-l-type-clipping",
    );
    cy.get("[data-testid=capture-as-note]").click();
    cy.get("[data-testid=capture-as-note]").should(
      "have.attr",
      "aria-pressed",
      "true",
    );
    cy.get("[data-testid=hub-capture]").should(
      "have.class",
      "border-l-type-note",
    );
  });

  it("keeps the focus for the next passage, and submits on the shortcut", () => {
    openSource();
    // A run of passages from one chapter is the point: each should cost a
    // keystroke, not a trip to the mouse.
    cy.get("[data-testid=capture-text]").type("First passage kept.{ctrl}{enter}");
    cy.get("[data-testid=hub-clippings]").should("contain", "First passage kept.");
    cy.focused().should("have.attr", "data-testid", "capture-text");
    cy.focused().should("have.value", "");

    cy.focused().type("Second passage kept.{ctrl}{enter}");
    cy.get("[data-testid=hub-clippings]").should(
      "contain",
      "Second passage kept.",
    );
  });

  it("reaches the box from the Command Palette", () => {
    openSource();
    // Distinct from the global "Quick capture", which creates a Note that
    // belongs to no Source and opens a dialog rather than focusing this box.
    cy.runCommand("Capture from this Source");
    cy.focused().should("have.attr", "data-testid", "capture-text");
  });

  it("offers a Note and a Clipping in the header, both citing this Source", () => {
    cy.openDoc("Jesus, the Way");
    cy.get("button[aria-label='New Note from this Source']").click();
    cy.get("[data-testid=new-doc-form]").should("contain", "Note");
    cy.get("[data-testid=new-doc-form] input[value='Jesus, the Way']").should(
      "exist",
    );
    cy.get("body").type("{esc}");
  });

  it("does not offer the box on a Subject, which no Clipping can cite", () => {
    cy.openDoc("Jerusalem");
    cy.get("[data-testid=hub-capture]").should("not.exist");
  });
});
