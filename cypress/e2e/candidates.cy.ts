// Candidates on a Composition: shared material the Composition does not yet
// link, versus material it already links, embeds or tags ("Used").
describe("Candidates", () => {
  beforeEach(() => cy.openApp());

  it("splits Candidates from material already used in the Composition", () => {
    cy.openDoc("Talk on endurance");
    // The Note shares #endurance and is not linked: a Candidate.
    cy.get("[data-testid=right-panel] [data-testid=candidates]")
      .parent()
      .should("contain", "Endurance in trials");
    // The Clipping is embedded (![[Endurance is steadfastness]]): used, not a Candidate.
    cy.get("[data-testid=right-panel] [data-testid=candidates]")
      .parent()
      .should("not.contain", "Endurance is steadfastness");
    cy.get("[data-testid=right-panel]")
      .contains("Used in this Composition")
      .click();
    cy.get("[data-testid=right-panel] [data-testid=used-material]")
      .parent()
      .should("contain", "Endurance is steadfastness");
  });

  it("Home counts only unused Candidates", () => {
    cy.docByTitle("Talk on endurance").then((d) => {
      cy.bridge<{ used: boolean }[]>("candidates", { id: d.id }).then((c) => {
        const unused = c.filter((x) => !x.used).length;
        expect(
          c.some((x) => x.used),
          "demo vault has used material",
        ).to.be.true;
        cy.get("[data-testid=home-progress]")
          .contains("Talk on endurance")
          .parents("li")
          .should("contain", `${unused} candidate`);
      });
    });
  });

  it("linking a Candidate from the Composition moves it to Used", () => {
    cy.openDoc("Talk on endurance");
    cy.get("[data-testid=right-panel] [data-testid=candidates]")
      .parent()
      .should("contain", "Endurance in trials");
    cy.get(".cm-content").click().type("{ctrl}{end}");
    cy.get(".cm-content").type("{enter}See also ");
    cy.get(".cm-content").type("[[Endurance in trials]]");
    cy.get("body").type("{esc}");
    // The panel re-queries once the edit is saved.
    cy.get("[data-testid=right-panel] [data-testid=candidates]")
      .parent()
      .should("not.contain", "Endurance in trials");
    cy.get("[data-testid=right-panel]")
      .contains("Used in this Composition")
      .click();
    cy.get("[data-testid=right-panel] [data-testid=used-material]")
      .parent()
      .should("contain", "Endurance in trials");
  });
});
