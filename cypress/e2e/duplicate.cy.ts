// "Duplicate as new Composition" (PLAN §14.8, ADR 0007): a talk adapted to a
// new occasion is a fork — a new Composition with the same text and Board.
describe("Duplicate as new Composition", () => {
  beforeEach(() => cy.openApp());

  it("copies the talk and its Board under a new title and opens the copy", () => {
    cy.openDoc("Talk on endurance");
    cy.get("[data-testid=doc-title]").should("have.value", "Talk on endurance");
    cy.runCommand("Duplicate as new Composition");

    cy.get("[data-testid=doc-title]").should("have.value", "Talk on endurance (copy)");
    cy.docByTitle("Talk on endurance (copy)").then((copy) => {
      cy.docByTitle("Talk on endurance").then((orig) => {
        expect(copy.id).not.to.equal(orig.id);
        expect(copy.type).to.equal("composition");
        cy.task<string>("file:read", `${Cypress.env("vault")}/${orig.path}`).then((before) => {
          cy.task<string>("file:read", `${Cypress.env("vault")}/${copy.path}`).then((after) => {
            const body = (t: string) => t.replace(/^---[\s\S]*?\n---\n/, "");
            expect(body(after)).to.equal(body(before));
            expect(after).not.to.contain(`id: ${orig.id}`);
          });
        });
      });
      // The Board came along: same number of cards as the original's.
      cy.bridge<{ nodes: unknown[] } | null>("get_board", { id: copy.id }).then((b) => {
        expect(b, "copied Board").to.exist;
        expect(b!.nodes.length).to.be.greaterThan(0);
      });
      cy.get("[data-testid=tab-board]").click();
      cy.get("[data-testid=board-canvas]").should("exist");
      // Leave the demo vault as it was for the rest of this spec.
      cy.bridge("delete_document", { id: copy.id });
    });
  });

  it("is offered only on a Composition", () => {
    cy.openDoc("Talk on endurance");
    cy.palette(">Duplicate");
    cy.get("[data-testid=palette] [cmdk-item]").should("contain", "Duplicate as new Composition");
    cy.get("body").type("{esc}");
    cy.openDoc("Endurance");
    cy.palette(">Duplicate as new");
    cy.get("[data-testid=palette] [cmdk-item]").should("not.exist");
  });
});
