// Walks the Delivery view Tutorial (docs/tutorials/delivery.en.md) step by
// step on the demo vault's "Talk on endurance" (`duration: 25`), so a change
// to the view that outdates the Tutorial fails here (PLAN §25.13). The view
// covers the Tutorial panel, so every step exits before the next.
describe("Tutorial: The Delivery view", () => {
  beforeEach(() => cy.openApp());

  const deliver = () => {
    cy.get("[data-testid=deliver]").click();
    cy.get("[data-testid=delivery]").should("be.visible");
  };
  const exit = () => {
    cy.get("[data-testid=delivery-exit]").click();
    cy.get("[data-testid=delivery]").should("not.exist");
    cy.get("[data-testid=tutorial-panel]").should("be.visible");
  };

  it("can be followed to the end", () => {
    cy.openDoc("Talk on endurance");
    cy.openTutorial("delivery");

    // 1. Open the Composition with Search, Deliver: the talk fills the screen,
    // locked and fully rendered. Escape comes back to the page.
    cy.tutorialStep(0);
    cy.tutorialCommand("nav.search");
    cy.get("[data-testid=palette] input[cmdk-input]").type("talk on endurance");
    cy.get("[data-testid=palette] [cmdk-item]").first().should("contain", "Talk on endurance");
    cy.get("[data-testid=palette] input[cmdk-input]").type("{enter}");
    cy.get("[data-testid=doc-title]").should("have.value", "Talk on endurance");
    cy.tutorialCommand("doc.deliver");
    cy.get("[data-testid=delivery]").should("be.visible");
    cy.get("[data-testid=delivery-talk] .cm-content")
      .should("contain", "Enduring with joy")
      .and("not.contain", "# Enduring")
      .and("have.attr", "contenteditable", "false");
    cy.get("body").type("{esc}");
    cy.get("[data-testid=delivery]").should("not.exist");
    cy.get("[data-testid=tab-talk]").should("have.attr", "aria-selected", "true");
    cy.tutorialNext();

    // 2. A Passage opens over the talk; Escape closes the card, not the view.
    // The face switch and the text size.
    cy.tutorialStep(1);
    deliver();
    cy.get("[data-testid=delivery-talk] [data-passage]").first().click();
    cy.get("[data-testid=hover-card]").should("be.visible");
    cy.get("body").type("{esc}");
    cy.get("[data-testid=hover-card]").should("not.exist");
    cy.get("[data-testid=delivery]").should("be.visible");
    cy.get("[data-testid=delivery-face-board]").click();
    cy.get("[data-testid=delivery] [data-testid=board-canvas]").should("exist");
    cy.get("[data-testid=delivery-face-talk]").click();
    cy.get("[data-testid=delivery-talk] .cm-editor").then(($e) => {
      const before = parseFloat(getComputedStyle($e[0]).fontSize);
      cy.get("[data-testid=delivery-larger]").click();
      cy.get("[data-testid=delivery-talk] .cm-editor").should(($a) => {
        expect(parseFloat(getComputedStyle($a[0]).fontSize)).to.be.greaterThan(before);
      });
      cy.get("[data-testid=delivery-smaller]").click();
      cy.get("[data-testid=delivery-talk] .cm-editor").should(($a) => {
        expect(parseFloat(getComputedStyle($a[0]).fontSize)).to.equal(before);
      });
    });
    exit();
    cy.tutorialNext();

    // 3. Start counts down from the duration, Exit keeps it running, Pause
    // and Reset.
    cy.tutorialStep(2);
    deliver();
    cy.get("[data-testid=delivery-timer]").should("have.text", "25:00").and("have.attr", "data-phase", "idle");
    cy.get("[data-testid=delivery-timer-toggle]").click();
    cy.get("[data-testid=delivery-timer]").should("have.attr", "data-phase", "running");
    cy.get("[data-testid=delivery-timer]", { timeout: 4000 }).should("not.have.text", "25:00");
    exit();
    deliver();
    cy.get("[data-testid=delivery-timer]").should("have.attr", "data-phase", "running").and("not.have.text", "25:00");
    cy.get("[data-testid=delivery-timer-toggle]").click();
    cy.get("[data-testid=delivery-timer]").should("not.have.attr", "data-phase", "running");
    cy.get("[data-testid=delivery-timer-reset]").click();
    cy.get("[data-testid=delivery-timer]").should("have.text", "25:00");
    exit();
    cy.tutorialNext();

    // 4. Do it once: Deliver, Start, Exit. The Composition is unchanged.
    cy.tutorialStep(3);
    cy.docByTitle("Talk on endurance").then((d) => {
      const file = `${Cypress.env("vault")}/${d.path}`;
      cy.task<string>("file:read", file).then((before) => {
        deliver();
        cy.get("[data-testid=delivery-timer-toggle]").click();
        cy.get("[data-testid=delivery-timer]").should("have.attr", "data-phase", "running");
        exit();
        cy.wait(1000); // past the editor's save debounce, so a write would have landed
        cy.task<string>("file:read", file).should("equal", before);
      });
    });
    cy.tutorialDone();
  });
});
