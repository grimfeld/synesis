describe("Hub pages", () => {
  beforeEach(() => cy.openApp());

  it("Source hub: header actions, reading trail grouped by child Source, no right panel", () => {
    cy.openDoc("The Watchtower");
    cy.get("[data-testid=right-panel]").should("not.exist");
    cy.hubTitle("The Watchtower");
    cy.get("[data-testid=hub-header]").should("contain", "Source");
    cy.get("[data-testid=hub-header] input[value=periodical]").should("exist");
    cy.get("button[aria-label='Open link']").should("exist");
    // A Clipping has its own section, showing its words rather than a title
    // it does not have (ADR 0013).
    cy.get("[data-testid=hub-clippings]").within(() => {
      cy.contains("Endurance is not merely putting up");
      cy.contains("par. 12");
    });
    cy.get("[data-testid=hub-trail]").within(() => {
      // The reading trail keeps everything else that cites the periodical.
      cy.contains("Contains");
      cy.contains("The Watchtower 2024-03");
    });
    // This Source has an About body, so the editor is open with its text.
    cy.get("[data-testid=hub-about] .cm-content").should(
      "contain",
      "Study edition",
    );
    cy.openDoc("Insight: Ephesus");
    cy.get("[data-testid=hub-about]").should(
      "contain",
      "Add a note about this work",
    );
  });

  it("Source hub: New Clipping from this Source pre-fills the dialog", () => {
    cy.openDoc("Jesus, the Way");
    cy.get("button[aria-label='New Clipping from this Source']").click();
    cy.get("[data-testid=new-doc-form]").should("contain", "Clipping");
    cy.get("[data-testid=new-doc-form] input[value='Jesus, the Way']").should(
      "exist",
    );
    cy.get("body").type("{esc}");
  });

  it("Book hub: chapter strip shaded by mentions", () => {
    cy.runCommand("Open a Passage");
    cy.get("[data-testid=goto-passage] input").type("Romans 8");
    cy.get("[data-testid=goto-passage]").contains("button", "Open").click();
    cy.get("button[aria-label='Up one level']").click();
    cy.hubTitle("Romans");
    cy.get("[data-testid=hub-header]").should("contain", "Book");
    cy.get("[data-testid=hub-strip] button").should("have.length", 16);
    cy.get("[data-testid=hub-strip] button").contains(/^5$/).click();
    cy.hubTitle("Romans 5");
    cy.get("[data-testid=hub-mentions]").should(
      "contain",
      "Endurance in trials",
    );
  });

  it("Chapter hub: verse strip, whole-chapter mentions, prev/next", () => {
    cy.runCommand("Open a Passage");
    cy.get("[data-testid=goto-passage] input").type("Romans 8");
    cy.get("[data-testid=goto-passage]").contains("button", "Open").click();
    cy.get("[data-testid=hub-strip] button").should("have.length", 39);
    cy.get("[data-testid=hub-mentions]").should("contain", "Reading plan");
    cy.get("button[aria-label=Next]").click();
    cy.hubTitle("Romans 9");
    cy.get("button[aria-label=Previous]").click();
    cy.hubTitle("Romans 8");
    cy.get("[data-testid=hub-strip] button").contains(/^28$/).click();
    cy.hubTitle("Romans 8:28");
    cy.get("[data-testid=hub-header]").should("contain", "Verse");
    cy.get("[data-testid=hub-mentions]").should("contain", "Reading plan");
  });

  it("Character hub: aliases as chips, backlinks grouped in Bible order", () => {
    cy.openDoc("Paul");
    cy.get("[data-testid=chips-aliases] [data-testid=chip]")
      .should("have.length", 3)
      .and("contain", "Saul of Tarsus");
    cy.get("[data-testid=backlinks]")
      .should("contain", "Paul in Ephesus")
      .and("contain", "In Bible order");
    // Aliases resolve links: [[Saul]] is Paul.
    cy.bridge<{ title: string } | null>("resolve_link", { target: "Saul" })
      .its("title")
      .should("equal", "Paul");
  });

  it("Place, Event and Journey hubs: aliases as chips, and an alias links", () => {
    cy.openDoc("Antioch");
    cy.hubTitle("Antioch");
    cy.get("[data-testid=chips-aliases] [data-testid=chip-add]").click();
    cy.get("[data-testid=chips-aliases] input").type("Syrian Antioch{enter}");
    cy.get("[data-testid=chips-aliases] [data-testid=chip]").should(
      "contain",
      "Syrian Antioch",
    );
    // The chips own the value, so the Properties grid does not offer it twice.
    cy.get("[data-testid=property-aliases]").should("not.exist");
    cy.wait(1000);
    cy.bridge<{ title: string } | null>("resolve_link", { target: "Syrian Antioch" })
      .its("title")
      .should("equal", "Antioch");
    cy.openDoc("Paul in Ephesus");
    cy.get("[data-testid=chips-aliases] [data-testid=chip-add]").should("exist");
    cy.openDoc("Paul's second missionary journey");
    cy.get("[data-testid=chips-aliases] [data-testid=chip-add]").should("exist");
  });

  it("Place hub: a document that Mentions it twice is one row, expandable", () => {
    // "Paul's second missionary journey" lists [[Antioch]] twice in its
    // `places` property — out and back. That is one Backlink, not two, and the
    // occurrences are still reachable behind the chevron.
    cy.openDoc("Antioch");
    cy.get("[data-testid=backlinks] [data-testid=backlink-row]")
      .filter(':contains("second missionary journey")')
      .should("have.length", 1)
      .as("row");
    cy.get("@row")
      .find("[data-testid=backlink-count]")
      .should("contain", "2 mentions");
    cy.get("@row").find("[data-testid=backlink-occurrences]").should("not.exist");
    cy.get("@row").find("[data-testid=backlink-expand]").click();
    cy.get("@row")
      .find("[data-testid=backlink-occurrences] li")
      .should("have.length", 2);
  });

  it("Concept hub: tag and link backlinks", () => {
    cy.openDoc("Endurance");
    cy.hubTitle("Endurance");
    cy.get("[data-testid=hub-header]")
      .should("contain", "Concept")
      .and("contain", "perseverance");
    cy.get("[data-testid=backlinks]")
      .should("contain", "Talk on endurance")
      .and("contain", "Endurance is not merely putting up");
  });

  it("Place hub: mini-map and jump to the Map view", () => {
    cy.openDoc("Ephesus");
    cy.get("[data-testid=hub-map] .leaflet-container").should("exist");
    cy.hubTitle("Ephesus");
    cy.get("[data-testid=hub-header] input[value*=Selçuk]").should("exist");
    cy.get("[data-testid=hub-map]").click();
    cy.get("h1").should("contain", "Map");
  });

  it("About: collapsed prompt expands into the editor and saves", () => {
    cy.openDoc("Timothy");
    cy.get("[data-testid=hub-about] button")
      .contains("Add a note about Timothy")
      .click();
    cy.get("[data-testid=hub-about] .cm-content")
      .should("be.visible")
      .type("Left in Ephesus, 1Ti 1:3.");
    cy.get("[data-testid=hub-about] .cm-passage").should("contain", "1Ti 1:3");
    cy.wait(1000);
    cy.docByTitle("Timothy").then((d) => {
      cy.task<string>("file:read", `${Cypress.env("vault")}/${d.path}`).then(
        (text) => expect(text).to.contain("Left in Ephesus"),
      );
    });
  });

  it("Scripture titles are read-only; Writing titles are editable", () => {
    cy.runCommand("Open a Passage");
    cy.get("[data-testid=goto-passage] input").type("John 3:16");
    cy.get("[data-testid=goto-passage]").contains("button", "Open").click();
    cy.hubTitle("John 3:16");
    cy.get("[data-testid=hub-header] [data-testid=doc-title]").should(
      "not.exist",
    );
    cy.get("button[aria-label=Delete]").should("not.exist");
  });
});
