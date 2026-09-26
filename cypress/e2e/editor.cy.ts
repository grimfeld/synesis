describe("Editor (Writing page)", () => {
  beforeEach(() => {
    cy.openApp();
    cy.openDoc("Endurance in trials");
    cy.get(".cm-content").should("contain", "Endurance in trials");
  });

  it("renders Live Preview: hidden markers, checkboxes, bullets, quote", () => {
    // Heading marks are replace decorations: "#" is absent from the DOM off the active line.
    // (Line 1 holds the cursor after autofocus, so look at the second heading.)
    cy.get(".cm-line.cm-md-heading-line-2")
      .should("not.contain", "#")
      .and("contain", "Cross-references");
    cy.get(".cm-md-task").should("have.length", 3);
    cy.get(".cm-md-task").first().should("be.checked");
    cy.get(".cm-md-bullet").should("have.length.greaterThan", 1);
    cy.get(".cm-md-quote-line").should("contain", "finished work");
    cy.get(".cm-line")
      .contains("Ro 5:3-5")
      .parents(".cm-line")
      .should("not.contain", "**");
  });

  it("goes Back and Forward with Alt+arrows while the editor has focus", function () {
    // Off macOS only: there Option+arrow is word motion in every text field,
    // and the editor keeps it.
    if (Cypress.platform === "darwin") this.skip();
    cy.openDoc("Talk on endurance");
    cy.openDoc("Endurance in trials");
    // CodeMirror binds Alt+arrows to its own motion; the app's must win.
    cy.get(".cm-content").click().type("{alt}{leftarrow}");
    cy.get("[data-testid=doc-title]").should("have.value", "Talk on endurance");
    cy.get(".cm-content").click().type("{alt}{rightarrow}");
    cy.get("[data-testid=doc-title]").should("have.value", "Endurance in trials");
  });

  it("toggles Source mode with Ctrl+E and the header button", () => {
    cy.get("body").type("{ctrl}e");
    cy.get(".cm-line").contains("## Cross-references").should("exist");
    cy.get("button[aria-label='Live Preview']").click();
    cy.get(".cm-line.cm-md-heading-line-2").should("not.contain", "#");
  });

  it("detects Passages and shows the hover card", () => {
    cy.get(".cm-passage").contains("Jas 1:2-4").click();
    cy.get("[data-testid=hover-card]")
      .should("be.visible")
      .and("contain", "Open page");
    cy.get("[data-testid=hover-card]").contains("button", "Open page").click();
    cy.hubTitle("James 1:2");
  });

  it("follows wikilinks and tags", () => {
    cy.get(".cm-wikilink").contains("Paul").click();
    cy.hubTitle("Paul");
    cy.get("[data-testid=hub-header]").should("contain", "Saul of Tarsus");
    cy.get("button[aria-label=Back]").click();
    cy.get(".cm-content").should("contain", "Endurance in trials");
  });

  it("clicking a checkbox toggles the task in the text", () => {
    cy.get(".cm-md-task").eq(1).should("not.be.checked").click();
    cy.get(".cm-md-task").eq(1).should("be.checked");
    cy.wait(1000);
    cy.docByTitle("Endurance in trials").then((d) => {
      cy.task<string>("file:read", `${Cypress.env("vault")}/${d.path}`).then(
        (text) => {
          expect(text).to.contain("- [x] Reread Jas 1");
        },
      );
    });
  });

  it("editor commands: bold, checkbox, heading", () => {
    cy.get(".cm-content").click().type("{ctrl}{end}").type("{enter}plain line");
    cy.get("body").type("{ctrl}l");
    cy.get(".cm-content").should("contain", "plain line");
    cy.get("body").type("{ctrl}e"); // read the raw text
    cy.get(".cm-content").should("contain", "- [ ] plain line");
    cy.get("body").type("{ctrl}e");
    cy.runCommand("Cycle heading");
    cy.get("body").type("{ctrl}e");
    cy.get(".cm-content").should("contain", "# - [ ] plain line");
    cy.get("body").type("{ctrl}e");
  });

  // Typed at a person's pace: the list opens after CodeMirror's activation
  // delay, so typing faster than that hid a list that never narrowed.
  it("autocompletes wikilinks and tags", () => {
    cy.get(".cm-content").click().type("{ctrl}{end}").type("{enter}See [[Geth", { delay: 150 });
    cy.get(".cm-tooltip-autocomplete").should("contain", "Gethsemane");
    cy.get("body").type("{esc}");
    cy.get(".cm-content").type("{enter}#pra", { delay: 150 });
    cy.get(".cm-tooltip-autocomplete").should("contain", "prayer");
  });

  it("edits tags as chips", () => {
    cy.get("[data-testid=chips-tags] [data-testid=chip]").should(
      "contain",
      "#endurance",
    );
    cy.get("[data-testid=chips-tags] [data-testid=chip-add]").click();
    cy.get("[data-testid=chips-tags] input").type("cypress tag{enter}");
    cy.get("[data-testid=chips-tags] [data-testid=chip]").should(
      "contain",
      "#cypress-tag",
    );
    cy.get("button[aria-label='Delete #cypress-tag']").click();
    cy.get("[data-testid=chips-tags]").should("not.contain", "#cypress-tag");
  });

  it("keeps a tag typed without Enter, and never carries text over", () => {
    // Leaving the input adds what was typed.
    cy.get("[data-testid=chips-tags] [data-testid=chip-add]").click();
    cy.get("[data-testid=chips-tags] input").type("left-by-blur").blur();
    cy.get("[data-testid=chips-tags] [data-testid=chip]").should("contain", "#left-by-blur");
    // Escape drops it, and the next input starts empty.
    cy.get("[data-testid=chips-tags] [data-testid=chip-add]").click();
    cy.get("[data-testid=chips-tags] input").type("dropped{esc}");
    cy.get("[data-testid=chips-tags] [data-testid=chip-add]").click();
    cy.get("[data-testid=chips-tags] input").should("have.value", "");
    // A comma separates two tags.
    cy.get("[data-testid=chips-tags] input").type("one, two{enter}");
    cy.get("[data-testid=chips-tags] [data-testid=chip]").should("contain", "#one").and("contain", "#two");
    cy.get("[data-testid=chips-tags]").should("not.contain", "dropped").and("not.contain", "#one,");
  });

  it("renames through the title, lowercasing the file", () => {
    cy.get("[data-testid=doc-title]")
      .clear()
      .type("Endurance In Trials Renamed{enter}");
    cy.get("[data-testid=doc-title]").should(
      "have.value",
      "Endurance In Trials Renamed",
    );
    cy.docByTitle("Endurance In Trials Renamed").then((d) => {
      expect(d.path).to.equal("Notes/endurance in trials renamed.md");
      cy.task<string>("file:read", `${Cypress.env("vault")}/${d.path}`).then(
        (text) => expect(text).to.contain("title: Endurance In Trials Renamed"),
      );
    });
    // Links elsewhere were rewritten.
    cy.docByTitle("Talk on endurance");
    cy.get("[data-testid=doc-title]")
      .clear()
      .type("Endurance in trials{enter}");
    cy.get("[data-testid=doc-title]").should(
      "have.value",
      "Endurance in trials",
    );
  });

  it("shows properties and backlinks in the right panel and can hide it", () => {
    cy.get("[data-testid=right-panel]")
      .should("contain", "Properties")
      .and("contain", "Backlinks");
    cy.get("[data-testid=right-panel] [data-testid=backlinks]").should(
      "contain",
      "Nothing links here yet",
    );
    // A Note's `source` is labelled "Source" here; nothing else on this screen
    // edits it, so the panel still offers it. The row is found by the Property
    // name whatever the label says.
    cy.get("[data-testid=right-panel] [data-testid=property-source]").should(
      "exist",
    );
    cy.get(
      "[data-testid=right-panel] input[value='[[Keep Enduring with Joy]]']",
    ).should("exist");
    cy.get("button[aria-label='Toggle side panel']").click();
    cy.get("[data-testid=right-panel]").should("not.exist");
    cy.get("button[aria-label='Toggle side panel']").click();
    cy.get("[data-testid=right-panel]").should("exist");
  });

  it("shows candidate material on a Composition", () => {
    cy.openDoc("Talk on endurance");
    cy.get("[data-testid=right-panel]").should("contain", "Candidate material");
    // Material the Composition neither uses nor keeps on its Board.
    cy.get("[data-testid=right-panel] [data-testid=candidates]")
      .parent()
      .should("contain", "Undeserved kindness in Romans");
  });
});
