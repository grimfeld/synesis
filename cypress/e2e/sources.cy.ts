// Sources (PLAN §28): a kind picker of nine, Properties out of the header, the
// page in the order a sitting uses it, and the sidebar's Shelf folders.
describe("Sources", () => {
  beforeEach(() => cy.openApp());

  /** The vertical position of a section, to check the page's order. */
  const top = (testId: string) =>
    cy.get(`[data-testid=${testId}]`).then(($el) => $el[0].getBoundingClientRect().top);

  it("files Sources in Shelf folders, parts folded under their parent", () => {
    cy.get("[data-testid=group-source]").click();
    // A folder per Shelf with anything on it; none for chapters or issues.
    cy.get("[data-testid=source-folder][data-shelf=book]").should("contain", "Books");
    cy.get("[data-testid=source-folder][data-shelf=periodical]").should("contain", "Periodicals");
    cy.get("[data-testid=source-folder][data-shelf=video]").should("exist");
    cy.get("[data-testid=source-folder][data-shelf=chapter]").should("not.exist");
    cy.get("[data-testid=source-folder][data-shelf=issue]").should("not.exist");
    cy.get("[data-testid=source-folder][data-shelf=podcast]").should("not.exist");
    // Folded until opened: a folder, then a parent.
    cy.get("[data-testid=doc-item]").contains("The Watchtower 2024-03").should("not.exist");
    cy.get("[data-testid=source-folder][data-shelf=periodical]").click();
    cy.get("[data-testid=doc-item]").contains("The Watchtower 2024-03").should("not.exist");
    cy.contains("[data-testid=doc-item]", /^The Watchtower$/)
      .parent()
      .find("[data-testid=source-node-toggle]")
      .click();
    cy.get("[data-testid=doc-item]").contains("The Watchtower 2024-03").should("be.visible");
    // The parent's own row opens it; only its chevron folds it.
    cy.contains("[data-testid=doc-item]", /^The Watchtower$/).click();
    cy.hubTitle("The Watchtower");
  });

  it("unfolds the sidebar to a Source opened from elsewhere", () => {
    cy.openDoc("Keep Enduring with Joy");
    cy.get("[data-testid=doc-item][data-active=true]")
      .should("contain", "Keep Enduring with Joy")
      .and("be.visible");
  });

  it("shows where a part sits, and each step opens its page", () => {
    cy.openDoc("Keep Enduring with Joy");
    cy.get("[data-testid=hub-breadcrumb] [data-testid=breadcrumb-step]").then(($s) => {
      expect([...$s].map((e) => e.textContent)).to.deep.equal(["The Watchtower", "The Watchtower 2024-03"]);
    });
    cy.get("[data-testid=hub-source-date]").should("contain", "2024-03");
    cy.get("[data-testid=breadcrumb-step]").first().click();
    cy.hubTitle("The Watchtower");
    // A Source that stands alone has no breadcrumb; its Part of is with the
    // other Properties instead.
    cy.get("[data-testid=hub-breadcrumb]").should("not.exist");
    cy.get("[data-testid=hub-properties] [data-testid=hub-part-of]").should("exist");
  });

  it("moves a part to another parent from its breadcrumb", () => {
    cy.openDoc("Insight: Ephesus");
    cy.get("[data-testid=part-of-edit]").click();
    // Never inside itself.
    cy.get("[data-testid=part-of-popover] [data-testid=part-of-picker]").clear().type("Insight");
    cy.get("[data-testid=part-of-popover]").should("not.contain", "Insight: Ephesus");
    cy.get("[data-testid=part-of-popover] [data-testid=part-of-picker]").clear().type("Jesus");
    cy.get("[data-testid=part-of-popover] button").contains("Jesus, the Way").click();
    cy.get("[data-testid=hub-breadcrumb]").should("contain", "Jesus, the Way");
    cy.get("[data-testid=part-of-edit]").click();
    cy.get("[data-testid=part-of-clear]").click();
    cy.get("[data-testid=hub-breadcrumb]").should("not.exist");
  });

  it("picks the kind from the nine, and keeps a hand-written one as written", () => {
    cy.openDoc("Morning Worship 2024-05-14");
    cy.get("[data-testid=hub-source-kind]").should("contain", "Video").click();
    cy.get("[role=option]").should("have.length", 9);
    cy.get("[data-testid=kind-option-talk]").click();
    cy.get("[data-testid=hub-source-kind]").should("contain", "Talk");
    cy.runCommand("Go to Library");
    cy.get("[data-testid=shelf-talk]").should("contain", "Morning Worship 2024-05-14");

    // ADR 0003: a kind nobody picked from the list is shown, never rewritten.
    cy.bridge("create_document", { docType: "source", title: "A Sermon", fields: { kind: "sermon" }, body: "" });
    cy.openDoc("A Sermon");
    cy.get("[data-testid=hub-source-kind]").should("contain", "sermon");
    cy.get("[data-testid=hub-kind-unknown]").should("contain", "Unshelved");
  });

  it("asks what holds a chapter named on a Source that sits in nothing", () => {
    cy.bridge("create_document", { docType: "source", title: "Loose Pages", fields: { kind: "article" }, body: "" });
    cy.openDoc("Loose Pages");
    cy.get("[data-testid=hub-source-kind]").click();
    cy.get("[data-testid=kind-option-chapter]").click();
    // Narrowed to books: a chapter's holder.
    cy.get("[data-testid=part-of-ask]").should("be.visible");
    cy.get("[data-testid=part-of-ask] [data-testid=part-of-picker]").should("be.focused");
    cy.get("[data-testid=part-of-ask]").should("contain", "Insight on the Scriptures").and("not.contain", "The Watchtower");
    cy.get("[data-testid=part-of-ask] button").contains("Insight on the Scriptures").click();
    cy.get("[data-testid=hub-breadcrumb]").should("contain", "Insight on the Scriptures");

    // Dismissed, the kind stays and the Source waits on Unshelved.
    cy.bridge("create_document", { docType: "source", title: "Stray Issue", fields: { kind: "article" }, body: "" });
    cy.openDoc("Stray Issue");
    cy.get("[data-testid=hub-source-kind]").click();
    cy.get("[data-testid=kind-option-issue]").click();
    cy.get("[data-testid=part-of-ask]").should("be.visible");
    cy.get("body").type("{esc}");
    cy.get("[data-testid=part-of-ask]").should("not.exist");
    cy.get("[data-testid=hub-source-kind]").should("contain", "Issue");
    cy.runCommand("Go to Library");
    cy.get("[data-testid=shelf-unshelved]").should("contain", "Stray Issue");
  });

  it("keeps Properties out of the header, at the foot above About", () => {
    cy.openDoc("The Watchtower");
    cy.get("[data-testid=hub-header] [data-testid=properties]").should("not.exist");
    cy.get("[data-testid=hub-properties] [data-testid=properties]").should("exist");
    // Owned by the header's own controls, so never offered twice.
    cy.get("[data-testid=hub-properties] [data-testid=property-kind]").should("not.exist");
    cy.get("[data-testid=hub-properties] [data-testid=property-cover]").should("not.exist");
    cy.get("[data-testid=hub-properties] [data-testid=property-parent]").should("not.exist");
    top("hub-properties").then((props) => top("hub-about").should("be.greaterThan", props));
    top("backlinks").then((back) => top("hub-properties").should("be.greaterThan", back));
    // The same on a Subject: a Place's header has no Properties grid either.
    cy.openDoc("Ephesus");
    cy.get("[data-testid=hub-header] [data-testid=properties]").should("not.exist");
    cy.get("[data-testid=hub-properties] [data-testid=property-lat]").should("exist");
  });

  it("puts capture, Contains and Clippings first", () => {
    cy.openDoc("The Watchtower");
    top("hub-capture").then((capture) => top("hub-contains").should("be.greaterThan", capture));
    top("hub-contains").then((contains) => top("hub-clippings").should("be.greaterThan", contains));
    top("hub-clippings").then((clippings) => top("hub-trail").should("be.greaterThan", clippings));
    // A video has no parts to add, so it offers no Contains until it holds one.
    cy.openDoc("Morning Worship 2024-05-14");
    cy.get("[data-testid=hub-contains]").should("not.exist");
  });
});
