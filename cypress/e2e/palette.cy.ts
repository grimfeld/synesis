describe("Command Palette", () => {
  beforeEach(() => cy.openApp());

  it("searches titles and content", () => {
    cy.palette("endurance");
    cy.get("[data-testid=palette]").within(() => {
      cy.contains("[cmdk-group-heading]", "Titles");
      cy.get("[cmdk-item]").contains("Endurance in trials");
      cy.get("[cmdk-item]").contains("Endurance"); // the Concept
      cy.contains("[cmdk-group-heading]", "Content");
      cy.get("[cmdk-item]").contains("Talk on endurance");
    });
  });

  // PLAN §10: search is filterable by type, by chip or by a `type:` token.
  it("narrows the search to one kind of page", () => {
    cy.palette("endurance");
    cy.get("[data-testid=palette-type-composition]").click();
    cy.get("[data-testid=palette] input[cmdk-input]").should(
      "have.value",
      "type:composition endurance ",
    );
    cy.get("[data-testid=palette-type-composition]").should("have.attr", "aria-pressed", "true");
    cy.get("[data-testid=palette] [cmdk-item]").should("contain", "Talk on endurance");
    cy.get("[data-testid=palette] [cmdk-item]").should("not.contain", "Endurance in trials");
    // Typed by hand, the same filter.
    cy.get("[data-testid=palette] input[cmdk-input]").clear().type("type:note endurance");
    cy.get("[data-testid=palette-type-note]").should("have.attr", "aria-pressed", "true");
    cy.get("[data-testid=palette] [cmdk-item]").should("contain", "Endurance in trials");
    cy.get("[data-testid=palette] [cmdk-item]").should("not.contain", "Talk on endurance");
    // With no words, the filter lists that kind of page.
    cy.get("[data-testid=palette] input[cmdk-input]").clear();
    cy.get("[data-testid=palette-type-composition]").click();
    cy.get("[data-testid=palette] [cmdk-item]").should("contain", "Talk on endurance").and("contain", "Student talk on prayer");
    // Clicking the chip again searches everything.
    cy.get("[data-testid=palette-type-composition]").click();
    cy.get("[data-testid=palette] input[cmdk-input]").should("have.value", "");
    // Command mode has no chips.
    cy.get("[data-testid=palette] input[cmdk-input]").type(">");
    cy.get("[data-testid=palette-types]").should("not.exist");
  });

  it("opens a document from the results", () => {
    cy.openDoc("Psalm 23 reflections");
    cy.get("[data-testid=doc-title]").should(
      "have.value",
      "Psalm 23 reflections",
    );
  });

  it("switches to commands with '>' and on Ctrl+Shift+P", () => {
    cy.palette(">");
    cy.get("[data-testid=palette]").within(() => {
      cy.contains("[cmdk-group-heading]", "Create");
      cy.contains("[cmdk-group-heading]", "Navigate");
      cy.get("[cmdk-item]").contains("New Note");
      cy.get("[cmdk-item]").contains("Go to Graph");
    });
    cy.get("body").type("{esc}");
    cy.get("[data-testid=palette]").should("not.exist");
    cy.get("body").type("{ctrl}{shift}p");
    cy.get("[data-testid=palette] input[cmdk-input]").should("have.value", ">");
    cy.get("[data-testid=palette] input[cmdk-input]").type("go to graph");
    cy.get("[data-testid=palette] [cmdk-item]")
      .should("have.length", 1)
      .and("contain", "Go to Graph");
  });

  it("runs navigation commands", () => {
    cy.runCommand("Go to Graph");
    cy.get("h1").should("contain", "Graph");
    cy.runCommand("Go to Map");
    cy.get("h1").should("contain", "Map");
    cy.runCommand("Back");
    cy.get("h1").should("contain", "Graph");
    cy.runCommand("Forward");
    cy.get("h1").should("contain", "Map");
    cy.runCommand("Go to Home");
    cy.get("h1").should("contain", "Home");
  });

  it("opens a Passage typed as text", () => {
    cy.runCommand("Open a Passage");
    cy.get("[data-testid=goto-passage] input").type("Ro 8:28");
    cy.get("[data-testid=goto-passage]").contains("button", "Open").click();
    cy.hubTitle("Romans 8:28");
  });

  it("rejects text that is not a Passage", () => {
    cy.runCommand("Open a Passage");
    cy.get("[data-testid=goto-passage] input").type("not a passage");
    cy.get("[data-testid=goto-passage]").contains("button", "Open").click();
    cy.get("[data-testid=goto-passage]").should(
      "contain",
      "No Passage recognised",
    );
  });

  it("offers to create a page from an unmatched query", () => {
    cy.palette("Zebra thoughts");
    cy.get("[data-testid=palette] [cmdk-item]")
      .contains("Create “Zebra thoughts”")
      .click();
    cy.get("[data-testid=new-doc-title]").should(
      "have.value",
      "Zebra thoughts",
    );
    cy.get("body").type("{esc}");
  });

  it("opens a random Note", () => {
    cy.runCommand("Open a random Note");
    cy.get("[data-testid=doc-title]").should("exist");
    cy.get("[data-testid=right-panel]").should("contain", "Note");
  });
});
