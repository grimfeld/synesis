// Reading mode (PLAN §23): the Device's lock on every Writing. Nothing can be
// typed, the title, Tags and Properties are fixed, a checkbox still ticks, and
// links still open.
describe("Reading mode", () => {
  beforeEach(() => {
    cy.openApp();
    // The lock is kept per Device, so start every test unlocked.
    cy.window().then((w) => w.localStorage.removeItem("synesis.readingMode"));
    cy.openApp();
  });

  const lock = () => {
    cy.get("[data-testid=reading-toggle]").click();
    cy.get("[data-testid=reading-toggle]").should(
      "have.attr",
      "aria-pressed",
      "true",
    );
  };

  it("stops typing in the body", () => {
    cy.openDoc("Talk on endurance");
    lock();
    cy.get(".cm-content").should("have.attr", "contenteditable", "false");
    cy.get(".cm-content").click();
    cy.get("body").type("ZZLOCKED");
    cy.get(".cm-content").should("not.contain", "ZZLOCKED");
    // And says why, rather than doing nothing silently.
    cy.contains("Reading mode is on").should("be.visible");
  });

  it("drops editing Commands run from the palette", () => {
    cy.openDoc("Talk on endurance");
    cy.get(".cm-content").then(($c) => {
      const before = $c.text();
      lock();
      cy.palette(">Bold");
      cy.get("[data-testid=palette] [cmdk-item]").should("not.exist");
      cy.get("body").type("{esc}");
      cy.get(".cm-content").should(($after) => {
        expect($after.text()).to.equal(before);
      });
    });
  });

  it("fixes the title, Tags and Properties", () => {
    cy.openDoc("Talk on endurance");
    lock();
    cy.get("[data-testid=doc-title]").should("not.exist");
    cy.get("[data-testid=doc-title-fixed]").should(
      "contain",
      "Talk on endurance",
    );
    cy.get("[data-testid=chips-tags] [data-testid=chip-add]").should(
      "not.exist",
    );
    cy.get(
      "[data-testid=chips-tags] [data-testid=chip] button[aria-label]",
    ).should("not.exist");
    cy.get("[data-testid=right-panel]").then(($p) => {
      if (!$p.is(":visible")) cy.get("[data-testid=toggle-panel]").click();
    });
    cy.get("[data-testid=properties]").should(
      "have.attr",
      "data-locked",
      "true",
    );
    cy.get("[data-testid=properties]").should("have.prop", "disabled", true);
    cy.get("[data-testid=add-property]").should("not.exist");
  });

  it("still ticks a checkbox", () => {
    cy.bridge<{ summary: { id: string } }>("create_document", {
      docType: "note",
      title: "Checklist to read",
      fields: {},
      body: "- [ ] bring the notes\n",
    }).then((d) => {
      cy.openApp();
      cy.openDoc("Checklist to read");
      lock();
      cy.get("input.cm-md-task").should("not.be.checked").click();
      cy.get("input.cm-md-task").should("be.checked");
      cy.wait(900); // the save is debounced
      cy.bridge<{ text: string }>("get_document", { id: d.summary.id }).should(
        (doc) => expect(doc.text).to.contain("- [x] bring the notes"),
      );
    });
  });

  it("keeps the lock across a reload, on every Writing", () => {
    cy.openDoc("Talk on endurance");
    lock();
    cy.openApp();
    cy.openDoc("Endurance in trials");
    cy.get("[data-testid=reading-toggle]").should(
      "have.attr",
      "aria-pressed",
      "true",
    );
    cy.get(".cm-content").should("have.attr", "contenteditable", "false");
    // Unlocking gives the editor back.
    cy.get("[data-testid=reading-toggle]").click();
    cy.get(".cm-content").should("have.attr", "contenteditable", "true");
  });

  it("opens the Board for reading", () => {
    cy.openDoc("Talk on endurance");
    lock();
    cy.get("[data-testid=tab-board]").click();
    cy.get("[data-testid=board-mode]").should(
      "have.attr",
      "aria-pressed",
      "true",
    );
  });

  it("still opens links", () => {
    cy.openDoc("Talk on endurance");
    lock();
    cy.get(".cm-content [data-link]").first().click();
    cy.get("[data-testid=hover-card], .cm-content").should("exist");
    cy.get("[data-testid=doc-title-fixed]").should(
      "not.contain",
      "Talk on endurance",
    );
  });
});
