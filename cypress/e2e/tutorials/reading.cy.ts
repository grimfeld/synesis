// Walks the Reading mode Tutorial (docs/tutorials/reading.en.md) step by step,
// doing what each step says, so a change to the lock that outdates the
// Tutorial fails here (PLAN §25.13).
describe("Tutorial: Reading mode", () => {
  beforeEach(() => {
    cy.openApp();
    // The lock is kept per Device, so start unlocked, as reading.cy.ts does.
    cy.window().then((w) => w.localStorage.removeItem("synesis.readingMode"));
    cy.openApp();
  });

  it("can be followed to the end", () => {
    cy.openDoc("Endurance in trials");
    cy.get(".cm-content").should("contain", "Endurance in trials");
    cy.openTutorial("reading");

    // 1. Open a Note with Search, lock it, and typing changes nothing.
    cy.tutorialStep(0);
    cy.tutorialCommand("nav.search");
    cy.get("[data-testid=palette] input[cmdk-input]").type("endurance in trials");
    cy.get("[data-testid=palette] [cmdk-item]").first().should("contain", "Endurance in trials");
    cy.get("[data-testid=palette] input[cmdk-input]").type("{enter}");
    cy.get("[data-testid=doc-title]").should("have.value", "Endurance in trials");
    cy.tutorialCommand("editor.reading");
    cy.get("[data-testid=reading-toggle]").should("have.attr", "aria-pressed", "true");
    cy.get(".cm-content").should("have.attr", "contenteditable", "false");
    cy.get(".cm-content").click();
    cy.get("body").type("ZZLOCKED");
    cy.get(".cm-content").should("not.contain", "ZZLOCKED");
    cy.contains("Reading mode is on").should("be.visible");
    cy.tutorialNext();

    // 2. A link still opens, Back returns, and the title is fixed.
    cy.tutorialStep(1);
    cy.get("[data-testid=doc-title-fixed]").should("contain", "Endurance in trials");
    cy.contains(".cm-content [data-link]", "Paul").click();
    cy.get("body").should(($b) => {
      expect($b.find("[data-testid=doc-title-fixed]").text()).not.to.contain("Endurance in trials");
    });
    cy.tutorialCommand("nav.back");
    cy.get("[data-testid=doc-title-fixed]").should("contain", "Endurance in trials");
    cy.tutorialNext();

    // 3. A Composition's Board opens for reading, and a card opens its document.
    cy.tutorialStep(2);
    cy.tutorialCommand("nav.search");
    cy.get("[data-testid=palette] input[cmdk-input]").type("talk on endurance");
    cy.get("[data-testid=palette] [cmdk-item]").first().should("contain", "Talk on endurance");
    cy.get("[data-testid=palette] input[cmdk-input]").type("{enter}");
    cy.get("[data-testid=doc-title-fixed]").should("contain", "Talk on endurance");
    cy.tutorialCommand("doc.board");
    cy.get("[data-testid=board-canvas]").should("exist");
    cy.get("[data-testid=board-mode]").should("have.attr", "aria-pressed", "true");
    cy.contains("[data-testid=board-canvas] div", "Endurance in trials").click();
    cy.get("[data-testid=board-canvas]").should("not.exist");
    cy.get("[data-testid=doc-title-fixed]").should("contain", "Endurance in trials");
    cy.tutorialNext();

    // 4. Do it once: unlock, and the choice outlives a reload.
    cy.tutorialStep(3);
    cy.tutorialCommand("editor.reading");
    cy.get("[data-testid=reading-toggle]").should("have.attr", "aria-pressed", "false");
    cy.get(".cm-content").should("have.attr", "contenteditable", "true");
    cy.tutorialDone();
    cy.openApp();
    cy.openDoc("Endurance in trials");
    cy.get("[data-testid=reading-toggle]").should("have.attr", "aria-pressed", "false");
    cy.get("[data-testid=doc-title]").should("have.value", "Endurance in trials");
  });
});
