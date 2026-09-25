// Walks the Pairing Tutorial (docs/tutorials/pairing.en.md) as far as one
// Device can: showing the Invite and reading the list of Devices. Joining
// needs a second Device, so the last step is only marked done (PLAN §25.13);
// cypress/e2e/pairing.cy.ts covers the approval dialog.
describe("Tutorial: Pairing", () => {
  beforeEach(() => cy.openApp());

  afterEach(() => {
    cy.bridge("pairing_stop");
  });

  it("can be followed to the end", () => {
    cy.get("[data-testid=nav-settings]").click();
    cy.get("h1").should("contain", "Settings");
    cy.openTutorial("pairing");

    // 1. Go to Settings; Show pairing code gives the Vault's Invite as QR and text.
    cy.tutorialStep(0);
    cy.tutorialCommand("nav.settings");
    cy.get("[data-testid=settings-sync] [data-testid=pairing-show]").click();
    cy.get("[data-testid=pairing-code]").invoke("val").should("match", /^synesis:[A-Za-z0-9_-]{40,}$/);
    cy.get("[data-testid=pairing-qr] svg").should("exist");
    cy.tutorialNext();

    // 2. The list under the code: this Device, marked as such.
    cy.tutorialStep(1);
    cy.get("[data-testid=pairing-members] li").should("have.length", 1).and("contain", "this device");
    cy.tutorialNext();

    // 3. Try it once needs another Device: the Invite is still there to scan.
    cy.tutorialStep(2);
    cy.get("[data-testid=pairing-code]").should("be.visible");
    cy.get("[data-testid=tutorial-panel]").should("be.visible");
    cy.tutorialDone();
  });
});
