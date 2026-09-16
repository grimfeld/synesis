// The Library (ADR 0012): Sources on Shelves by kind, Covers resolved three
// ways, and the two gestures that add parts to a Source.
describe("Library", () => {
  beforeEach(() => cy.openApp());

  const openLibrary = () => {
    // The palette does not depend on whether the rail happens to be open.
    cy.runCommand("Go to Library");
    cy.get("[data-testid=library]").should("exist");
  };

  it("shelves top-level Sources by kind and keeps parts off the shelves", () => {
    openLibrary();
    // The demo vault: two books, one periodical, one video at the top level.
    cy.get("[data-testid=shelf-book] [data-testid=library-card]").should(
      "have.length",
      2,
    );
    cy.get("[data-testid=shelf-periodical] [data-testid=library-card]").should(
      "have.length",
      1,
    );
    cy.get("[data-testid=shelf-video] [data-testid=library-card]").should(
      "have.length",
      1,
    );
    // An issue, an article and a chapter all sit inside a parent, so none of
    // them stands on a Shelf and neither kind gets a row of its own.
    cy.get("[data-testid=shelf-issue]").should("not.exist");
    cy.get("[data-testid=shelf-chapter]").should("not.exist");
    cy.get("[data-testid=library]").should("not.contain", "Insight: Ephesus");
    cy.get("[data-testid=library]").should("not.contain", "Keep Enduring");
    // Every demo Source is filed, so there is nothing waiting to be.
    cy.get("[data-testid=shelf-unshelved]").should("not.exist");
  });

  it("puts a Cover on every card, drawn when there is no picture", () => {
    openLibrary();
    // A stored picture is read back through the engine and shown as an image.
    cy.get("[data-testid=shelf-book]")
      .contains("[data-testid=library-card]", "Insight on the Scriptures")
      .find("[data-testid=cover-image]")
      .should("exist");
    // A Source with no `cover` still has a Cover: one drawn from its own
    // title, kind and date, so the Shelf reads as a library from day one.
    cy.get("[data-testid=shelf-video]")
      .contains("[data-testid=library-card]", "Morning Worship")
      .find("[data-testid=cover-drawn]")
      .should("contain", "Morning Worship");
  });

  it("shows what is inside a Source, and opens its Hub when clicked", () => {
    openLibrary();
    cy.get("[data-testid=shelf-periodical]")
      .contains("[data-testid=library-card]", "The Watchtower")
      .should("contain", "1 part")
      .scrollIntoView()
      .click();
    cy.hubTitle("The Watchtower");
    // The Library is an index; what is inside a Source lives on its Hub.
    cy.get("[data-testid=hub-trail]").should("contain", "Contains");
  });

  it("shelves a Source whose kind the app does not know as Unshelved", () => {
    // ADR 0003: the vault is hand-editable, so an unknown kind must land
    // somewhere visible rather than breaking the view or vanishing.
    cy.bridge("create_document", {
      docType: "source",
      title: "A Sermon",
      fields: { kind: "sermon" },
      body: "",
    });
    openLibrary();
    cy.get("[data-testid=shelf-unshelved]").should("contain", "A Sermon");
  });

  it("shelves a part that lost its parent as Unshelved, not as its own row", () => {
    // A chapter with a dangling parent is misfiled, not top-level. The row is
    // the user's fix-it queue.
    cy.bridge("create_document", {
      docType: "source",
      title: "Orphan Chapter",
      fields: { kind: "chapter", parent: "[[No Such Book]]" },
      body: "",
    });
    openLibrary();
    cy.get("[data-testid=shelf-chapter]").should("not.exist");
    cy.get("[data-testid=shelf-unshelved]").should("contain", "Orphan Chapter");
  });

  it("adds a part from the parent's own page, one Enter at a time", () => {
    cy.openDoc("Jesus, the Way");
    cy.get("[data-testid=add-child-input]").type("Chapter 2{enter}");
    cy.get("[data-testid=hub-trail]").should("contain", "Chapter 2");
    // The field keeps focus, so a dozen chapters is a dozen keystrokes.
    cy.get("[data-testid=add-child-input]")
      .should("not.be.disabled")
      .and("have.value", "");
    cy.focused().should("have.attr", "data-testid", "add-child-input");
    cy.get("[data-testid=add-child-input]").type("Chapter 10{enter}");
    cy.get("[data-testid=hub-trail]").should("contain", "Chapter 10");
    // Inherited, not typed: the parent's book makes its parts chapters.
    cy.docByTitle("Chapter 2").its("type").should("equal", "source");
  });

  it("lists parts in natural order, not alphabetical", () => {
    // "Chapter 10" before "Chapter 2" is what plain string ordering gives and
    // what makes a contents list read scrambled.
    cy.openDoc("Jesus, the Way");
    cy.get("[data-testid=add-child-input]").type("Chapter 2{enter}");
    cy.get("[data-testid=add-child-input]").type("Chapter 10{enter}");
    cy.get("[data-testid=hub-trail]")
      .invoke("text")
      .should((text: string) => {
        expect(text.indexOf("Chapter 2")).to.be.lessThan(
          text.indexOf("Chapter 10"),
        );
      });
  });

  it("creates a whole contents page from one paste, behind a confirm", () => {
    cy.openDoc("Jesus, the Way");
    cy.get("[data-testid=add-child-input]").then(($el) => {
      const data = new DataTransfer();
      data.setData("text/plain", "Part One\nPart Two\nPart Three");
      $el[0].dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    // Twelve new files is not something to do silently.
    cy.get("[data-testid=add-children-confirm]").should("contain", "3");
    cy.get("[data-testid=add-children-confirm]").contains("button", "Create").click();
    cy.get("[data-testid=hub-trail]").should("contain", "Part One");
    cy.get("[data-testid=hub-trail]").should("contain", "Part Three");
  });

  it("opens the dialog with the parent settled when added from its page", () => {
    cy.openDoc("Insight on the Scriptures");
    cy.get("button[aria-label^='Add a part']").click();
    cy.get("[data-testid=new-doc-form]").should("contain", "Source");
    // Filled and locked: standing on the book is what chose the parent.
    cy.get("[data-testid=parent-picker]")
      .should("have.value", "Insight on the Scriptures")
      .and("be.disabled");
    cy.get("body").type("{esc}");
  });
});

describe("A Cover is named after its Source", () => {
  beforeEach(() => cy.openApp());

  it("holds a picked Cover back until the Source has a title", () => {
    // The file name is the only thing tying a picture to its Source, and in
    // the New dialog the title is not settled until submit. Staging is what
    // stops a Cover landing as `Attachments/untitled.jpg` (ADR 0012).
    cy.runCommand("New Source");
    cy.get("[data-testid=cover-input]").type("https://example.org/cover.jpg");
    cy.get("[data-testid=cover-save-copy]").click();
    // Staged, not written: the field says so rather than showing a path that
    // does not exist.
    cy.get("[data-testid=cover-staged]").should("exist");
    cy.get("[data-testid=cover-input]").should("not.exist");
  });

  it("refuses to name an attachment before there is a title", () => {
    // The engine is the backstop: even a caller that forgets to stage cannot
    // write `untitled.jpg`. A refusal is a 500, so the request is made raw.
    cy.request({
      method: "POST",
      url: `${Cypress.env("bridge")}/invoke/attach_image`,
      body: { title: "", path: "cover.png" },
      headers: { "content-type": "application/json" },
      failOnStatusCode: false,
    }).then((r) => {
      expect(r.status).to.equal(500);
      expect(JSON.stringify(r.body)).to.contain("title");
    });
  });
});

describe("Part of is never plain text", () => {
  beforeEach(() => cy.openApp());

  it("keeps a typo out of the vault instead of writing a dangling link", () => {
    cy.runCommand("New Source");
    cy.get("[data-testid=new-doc-form] [data-testid=new-doc-title]").type("A Chapter");
    // Typed, never picked: the old picker wrapped this in [[…]] regardless.
    cy.get("[data-testid=parent-picker]").type("The Watchtwoer");
    // Take focus off the picker so its Create row is not under the cursor.
    cy.get("[data-testid=new-doc-title]").click();
    cy.get("[data-testid=new-doc-form] [data-testid=submit-doc]").click();
    cy.get("[data-testid=new-doc-form]").should("not.exist");
    // The Source is still created — only the bad parent is refused, so the
    // typo never becomes a `[[wikilink]]` pointing at nothing.
    cy.docByTitle("A Chapter").then((doc: { id: string }) => {
      cy.bridge<{ text: string }>("get_document", { id: doc.id }).then((full) => {
        expect(full.text).not.to.contain("The Watchtwoer");
        expect(full.text).to.contain('parent: ""');
      });
    });
  });

  it("captures the picked Source rather than the characters typed", () => {
    cy.runCommand("New Source");
    cy.get("[data-testid=new-doc-form] [data-testid=new-doc-title]").type("A Real Chapter");
    cy.get("[data-testid=parent-picker]").type("Watchtower");
    cy.get("[data-testid=parent-picker]").parent().find("li button").first().click();
    cy.get("[data-testid=submit-doc]").click();
    cy.docByTitle("A Real Chapter").then((doc: { id: string }) => {
      cy.bridge<{ text: string }>("get_document", { id: doc.id }).then((full) => {
        expect(full.text).to.contain("[[The Watchtower");
      });
    });
  });

  it("offers an explicit Create row for a Source that does not exist yet", () => {
    cy.runCommand("New Source");
    cy.get("[data-testid=new-doc-form] [data-testid=new-doc-title]").type("Part Of A New Book");
    cy.get("[data-testid=parent-picker]").type("A Brand New Book");
    cy.get("[data-testid=picker-create]").should("contain", "A Brand New Book").click();
    cy.get("[data-testid=parent-picker]").should("have.value", "A Brand New Book");
    cy.get("[data-testid=submit-doc]").click();
    // The parent is a real Source now, not a dangling name.
    cy.docByTitle("A Brand New Book").its("type").should("equal", "source");
  });
});
