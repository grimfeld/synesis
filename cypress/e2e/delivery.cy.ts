// The Delivery view (PLAN §23): a Composition given full screen, from its
// text, its Board or both, with a timer. Nothing edits and nothing navigates.
// The demo "Talk on endurance" carries `duration: 25`.
describe("Delivery view", () => {
  beforeEach(() => cy.openApp());

  const deliver = (title = "Talk on endurance") => {
    cy.openDoc(title);
    cy.get("[data-testid=deliver]").click();
    cy.get("[data-testid=delivery]").should("be.visible");
  };

  it("shows the talk locked, and exits back to the page", () => {
    deliver();
    cy.get("[data-testid=delivery-talk] .cm-content")
      .should("contain", "Enduring with joy")
      .and("have.attr", "contenteditable", "false");
    cy.get("[data-testid=delivery-exit]").click();
    cy.get("[data-testid=delivery]").should("not.exist");
    cy.get("[data-testid=tab-talk]").should(
      "have.attr",
      "aria-selected",
      "true",
    );
  });

  it("exits on Escape", () => {
    deliver();
    cy.get("body").type("{esc}");
    cy.get("[data-testid=delivery]").should("not.exist");
  });

  it("renders every line, even where a tap put the cursor", () => {
    deliver();
    cy.get("[data-testid=delivery-talk] .cm-content").click("topLeft");
    cy.get("[data-testid=delivery-talk] .cm-content").should(
      "not.contain",
      "# Enduring",
    );
  });

  it("counts down from the duration, and keeps time across an exit", () => {
    cy.clock(Date.now());
    deliver();
    cy.get("[data-testid=delivery-timer]")
      .should("have.text", "25:00")
      .and("have.attr", "data-phase", "idle");
    cy.get("[data-testid=delivery-timer-toggle]").click();
    cy.tick(61_000);
    cy.get("[data-testid=delivery-timer]")
      .should("have.text", "23:59")
      .and("have.attr", "data-phase", "running");
    // An accidental exit costs nothing.
    cy.get("[data-testid=delivery-exit]").click();
    cy.tick(60_000);
    cy.get("[data-testid=deliver]").click();
    cy.get("[data-testid=delivery-timer]").should("have.text", "22:59");
    // Amber for the last two minutes, red and overtime after.
    cy.tick(21 * 60_000);
    cy.get("[data-testid=delivery-timer]").should(
      "have.attr",
      "data-phase",
      "warning",
    );
    cy.tick(3 * 60_000);
    cy.get("[data-testid=delivery-timer]")
      .should("have.attr", "data-phase", "over")
      .and("contain", "+");
    cy.get("[data-testid=delivery-timer-reset]").click();
    cy.get("[data-testid=delivery-timer]").should("have.text", "25:00");
  });

  it("counts up without a duration", () => {
    cy.bridge("create_document", {
      docType: "composition",
      title: "Untimed talk",
      fields: {},
      body: "A talk with no set length.\n",
    });
    cy.openApp();
    deliver("Untimed talk");
    cy.get("[data-testid=delivery-timer]").should("have.text", "0:00");
  });

  it("opens a Passage over the talk without leaving it", () => {
    deliver();
    cy.get("[data-testid=delivery-talk] [data-passage]").first().click();
    cy.get("[data-testid=hover-card]").should("be.visible");
    // No way out from the card.
    cy.get("[data-testid=hover-card]")
      .contains("Open page")
      .should("not.exist");
    cy.get("[data-testid=delivery]").should("be.visible");
  });

  it("opens a link over the talk without leaving it", () => {
    deliver();
    cy.get("[data-testid=delivery-talk] [data-link]").first().click();
    cy.get("[data-testid=hover-card]").should("be.visible");
    cy.get("[data-testid=delivery]").should("be.visible");
  });

  it("gives a talk from its Board, and opens a card over it", () => {
    deliver();
    cy.get("[data-testid=delivery-face-board]").click();
    cy.get("[data-testid=delivery] [data-testid=board-canvas]").should("exist");
    // Reading only: no mode toggle, no tools.
    cy.get("[data-testid=delivery] [data-testid=board-mode]").should(
      "not.exist",
    );
    cy.contains(
      "[data-testid=board-canvas] div",
      "Endurance in trials",
    ).click();
    cy.get("[data-testid=hover-card]").should("contain", "Endurance in trials");
    cy.get("[data-testid=delivery]").should("be.visible");
  });

  it("opens on the face that was showing", () => {
    cy.openDoc("Talk on endurance");
    cy.get("[data-sidebar=trigger]").first().click();
    cy.get("[data-testid=tab-split]").click();
    cy.get("[data-testid=deliver]").click();
    cy.get("[data-testid=delivery-face-split]").should(
      "have.attr",
      "aria-selected",
      "true",
    );
    cy.get("[data-testid=delivery] [data-testid=split-board]").should("exist");
  });

  it("sizes the text and remembers it", () => {
    deliver();
    cy.get("[data-testid=delivery-talk] .cm-editor").then(($e) => {
      const before = parseFloat(getComputedStyle($e[0]).fontSize);
      cy.get("[data-testid=delivery-larger]").click().click();
      cy.get("[data-testid=delivery-talk] .cm-editor").should(($a) => {
        expect(parseFloat(getComputedStyle($a[0]).fontSize)).to.equal(
          before + 8,
        );
      });
      cy.get("[data-testid=delivery-exit]").click();
      cy.get("[data-testid=deliver]").click();
      cy.get("[data-testid=delivery-talk] .cm-editor").should(($a) => {
        expect(parseFloat(getComputedStyle($a[0]).fontSize)).to.equal(
          before + 8,
        );
      });
    });
  });

  it("leaves the page's editor working after it closes", () => {
    deliver();
    cy.get("[data-testid=delivery-exit]").click();
    cy.get(".cm-content").click();
    cy.runCommand("Bold");
    cy.get(".cm-content").should("contain", "****");
  });
});
