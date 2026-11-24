// Walks the Candidates Tutorial (docs/tutorials/candidates.en.md) step by
// step, doing what each step says, so a change to the Candidates panel that
// outdates the Tutorial fails here (PLAN §25.13).
import { dragRowOntoLine } from "../../support/drag";

describe("Tutorial: Candidates", () => {
  /** A Candidate row's button in the panel, by document id. */
  const candidateRow = (id: string) =>
    `[data-testid=right-panel] [data-testid=candidate][data-doc="${id}"] [data-testid=candidate-open]`;

  const dragOntoLine = (id: string, line: string) => dragRowOntoLine(candidateRow(id), line);

  beforeEach(() => cy.openApp());

  it("can be followed to the end", () => {
    // The Composition editor lists this Tutorial.
    cy.openDoc("Talk on endurance");
    cy.get("[data-testid=doc-title]").should("have.value", "Talk on endurance");
    cy.openTutorial("candidates");

    // 1. Home's Compositions in progress count Candidates and open the Composition.
    cy.tutorialStep(0);
    cy.tutorialCommand("nav.home");
    cy.get("[data-testid=home-progress]")
      .contains("button", "Talk on endurance")
      .should("contain", "candidate")
      .click();
    cy.get("[data-testid=doc-title]").should("have.value", "Talk on endurance");
    cy.tutorialNext();

    // 2. Candidate material in the right panel; open one and come back.
    cy.tutorialStep(1);
    cy.get("[data-testid=right-panel]").should("contain", "Candidate material");
    cy.get("[data-testid=right-panel] [data-testid=candidates]")
      .parent()
      .contains("button", "Undeserved kindness in Romans")
      .should("contain", "#endurance")
      .click();
    cy.get("[data-testid=doc-title]").should("have.value", "Undeserved kindness in Romans");
    cy.tutorialCommand("nav.back");
    cy.get("[data-testid=doc-title]").should("have.value", "Talk on endurance");
    cy.tutorialNext();

    // 3. Do it once: drag a Candidate into the text, then link another from
    // a new line; both move to Used. "Week 10" shares Ro 5:3-5 with the talk
    // and is neither used nor on the Board.
    cy.tutorialStep(2);
    cy.docByTitle("Week 10").then((week) => {
      cy.get("[data-testid=right-panel] [data-testid=candidates]")
        .parent()
        .find(candidateRow(week.id))
        .should("have.attr", "draggable", "true");
      dragOntoLine(week.id, "Jas 1:2 sounds impossible");
      // A Note arrives as a link, inline where it was dropped.
      cy.contains(".cm-line", "Jas 1:2 sounds impossible").should("contain", "[[Week 10]]");
      cy.get(".cm-content").should("not.contain", "![[Week 10");
      // The panel re-queries once the edit is saved.
      cy.get("[data-testid=right-panel] [data-testid=candidates]")
        .parent()
        .find(`[data-doc="${week.id}"]`)
        .should("not.exist");
    });
    // Focus, not click: the middle of this Composition is an Embed, which opens.
    cy.get(".cm-content").first().focus().type("{ctrl}{end}");
    cy.get(".cm-content").type("{enter}See also ");
    cy.tutorialCommand("editor.link");
    // Typed whole between the brackets the Command put in (see the note in
    // compositions.cy.ts on why the list is not driven).
    cy.focused().type("Undeserved kindness in Romans");
    cy.get("body").type("{esc}");
    cy.get("[data-testid=right-panel] [data-testid=candidates]")
      .parent()
      .should("not.contain", "Undeserved kindness in Romans");
    cy.get("[data-testid=right-panel]").contains("Used in this Composition").click();
    cy.get("[data-testid=right-panel] [data-testid=used-material]")
      .parent()
      .should("contain", "Undeserved kindness in Romans")
      .and("contain", "Week 10");
    cy.tutorialDone();
  });
});
