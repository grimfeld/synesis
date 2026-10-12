describe("Home", () => {
  beforeEach(() => cy.openApp());

  it("opens on Home with the vault name in the sidebar", () => {
    cy.get("h1").should("contain", "Home");
    cy.get("[data-sidebar=header]").should("contain", "documents");
  });

  it("lists recent Writing pages only", () => {
    // Recent is the ten newest, and the seeded copy gives every file about the
    // same time, so which ten is luck: make these two the newest first.
    for (const rel of ["Notes/endurance in trials.md", "Compositions/talk on endurance.md"]) {
      const path = `${Cypress.env("vault")}/${rel}`;
      cy.task<string>("file:read", path).then((text) => cy.task("file:write", { path, text }));
    }
    cy.reload();
    cy.get("[data-testid=home-recent]").within(() => {
      cy.contains("Endurance in trials");
      cy.contains("Talk on endurance");
      cy.contains("The Watchtower").should("not.exist");
      cy.contains("Romans 8").should("not.exist");
    });
  });

  it("shows Compositions in progress with candidate counts", () => {
    cy.get("[data-testid=home-progress]").within(() => {
      cy.contains("Talk on endurance");
      cy.contains("Student talk on prayer");
      cy.contains(/\d+ candidates?/);
    });
  });

  it("quick capture creates a Note", () => {
    cy.get("[data-testid=home-quick] textarea").type(
      "Captured from Cypress, see Ro 12:2.{ctrl}{enter}",
    );
    // The Note is titled with a timestamp and lands at the top of Recent.
    cy.get("[data-testid=home-recent] li").first().should("contain.text", "20");
    cy.get("[data-testid=home-quick] textarea").should("have.value", "");
    cy.query<{ title: string; type: string }[]>({
      kind: "list",
      docType: "note",
    }).then((notes) => {
      const created = notes.find((n) =>
        /^\d{4}-\d{2}-\d{2} \d{2}\.\d{2}$/.test(n.title),
      );
      expect(created, "timestamped note").to.exist;
    });
  });
});
