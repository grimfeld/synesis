// The Tutorial panel (PLAN §24.6, §24.9, §24.11): opened from a view's "?",
// docked beside the view and staying open across navigation, stepping with
// next and back, running a step's Command links, and remembering where the
// user was. Each Tutorial's own steps are walked in cypress/e2e/tutorials/.
describe("Tutorials", () => {
  beforeEach(() => cy.openApp());

  it("opens a view's list from its \"?\", and a Tutorial from the list", () => {
    cy.get("[data-testid=tutorial-button]").first().click();
    cy.get("[data-testid=tutorial-panel]").should("have.attr", "data-layout", "docked");
    // Home lists capture and Compositions, and the Command Palette as everywhere.
    cy.get("[data-testid=tutorial-list-item]").then((items) => {
      const ids = [...items].map((el) => el.getAttribute("data-id"));
      expect(ids).to.include.members(["capture", "compositions", "palette"]);
      expect(ids[ids.length - 1]).to.equal("palette");
    });
    cy.get('[data-testid=tutorial-list-item][data-id="palette"]').click();
    cy.get("[data-testid=tutorial-body]").should("have.attr", "data-id", "palette");
    cy.tutorialStep(0);
    cy.get("[data-testid=tutorial-to-list]").click();
    cy.get("[data-testid=tutorial-list]").should("be.visible");
    cy.get("[data-testid=tutorial-close]").click();
    cy.get("[data-testid=tutorial-panel]").should("not.exist");
  });

  it("steps forward and back, and jumps to a step that is clicked", () => {
    cy.openTutorial("palette");
    cy.get("[data-testid=tutorial-back]").should("be.disabled");
    cy.tutorialNext();
    cy.tutorialStep(1);
    cy.get("[data-testid=tutorial-back]").click();
    cy.tutorialStep(0);
    cy.get("[data-testid=tutorial-step][data-index=2]").click();
    cy.tutorialStep(2);
    cy.get("[data-testid=tutorial-next]").should("not.exist");
    cy.get("[data-testid=tutorial-done]").should("exist");
  });

  it("runs a step's Command link, with the Command's own title", () => {
    cy.openTutorial("palette");
    cy.get('[data-testid=tutorial-step][data-current=true] [data-testid=command-link][data-command="nav.search"]').should("contain", "Search").click();
    cy.get("[data-testid=palette]").should("be.visible");
  });

  it("shows a Command that does not apply here as plain text", () => {
    // Quick capture & Notes names editor Commands; on Home there is no editor.
    cy.openTutorial("capture");
    cy.get('[data-testid=command-link][data-available="false"]').each(($a) => {
      expect($a.prop("tagName")).to.equal("SPAN");
    });
  });

  it("stays open beside the view while the user moves around", () => {
    cy.openTutorial("palette");
    cy.tutorialNext();
    cy.get("[data-testid=nav-timeline]").click();
    cy.get("[data-testid=timeline]").should("exist");
    cy.get("[data-testid=tutorial-body]").should("have.attr", "data-id", "palette");
    cy.tutorialStep(1);
    cy.openDoc("Psalm 23 reflections");
    cy.get("[data-testid=tutorial-panel]").should("be.visible");
  });

  it("resumes where the user left off, and marks a finished Tutorial", () => {
    cy.openTutorial("palette");
    cy.tutorialNext();
    cy.reload();
    cy.get("[data-testid=home-recent]").should("exist");
    cy.openTutorial("palette");
    cy.tutorialStep(1);
    cy.tutorialNext();
    cy.tutorialDone();
    cy.get("[data-testid=tutorial-progress]").should("contain", "Finished");
    cy.get("[data-testid=tutorial-to-list]").click();
    cy.get('[data-testid=tutorial-list-item][data-id="palette"]').should("have.attr", "data-done", "true");
    // A finished Tutorial opens at the start, still finished.
    cy.get('[data-testid=tutorial-list-item][data-id="palette"]').click();
    cy.tutorialStep(0);
  });

  it("is a Command in the palette", () => {
    cy.palette(">tutorial");
    cy.get("[data-testid=palette] [cmdk-item]").contains("Tutorial: The Command Palette").click();
    cy.get("[data-testid=tutorial-body]").should("have.attr", "data-id", "palette");
  });

  it("shows the pictures the image setting asks for", () => {
    cy.get("[data-testid=nav-settings]").click();
    cy.get("[data-testid=tutorial-image-mode]").click();
    cy.get("[data-testid=tutorial-image-mode-screenshots]").click();
    cy.get("[data-testid=nav-timeline]").click();
    cy.openTutorial("timeline");
    cy.get("[data-testid=tutorial-image]").should("have.attr", "data-mode", "screenshots").and("have.attr", "src").and("match", /timeline\.en\.(light|dark)/);
    cy.get("[data-testid=nav-settings]").click();
    cy.get("[data-testid=tutorial-image-mode]").click();
    cy.get("[data-testid=tutorial-image-mode-diagrams]").click();
    cy.get("[data-testid=tutorial-image]").should("have.attr", "data-mode", "diagrams").and("have.attr", "src").and("match", /timeline/);
    cy.get("[data-testid=tutorial-image-mode]").click();
    cy.get("[data-testid=tutorial-image-mode-none]").click();
    cy.get("[data-testid=tutorial-image]").should("not.exist");
  });

  it("is a bottom sheet on a phone, and shrinks to a strip", () => {
    cy.viewport(390, 844);
    cy.reload();
    cy.get("[data-testid=home-recent]").should("exist");
    cy.openTutorial("palette");
    cy.get("[data-testid=tutorial-panel]").should("have.attr", "data-layout", "sheet");
    cy.get("[data-testid=tutorial-collapse]").click();
    cy.get("[data-testid=tutorial-strip]").should("be.visible").and("contain", "Step 1 of 3");
    // The view underneath is usable while the strip is showing.
    cy.get("[data-testid=home-recent]").should("be.visible");
    cy.get("[data-testid=tutorial-expand]").click();
    cy.get("[data-testid=tutorial-panel]").should("be.visible");
  });
});
