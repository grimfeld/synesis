describe("Onboarding wizard", () => {
  const newVault = () => `${Cypress.env("vault")}${Cypress.platform === "win32" ? "\\" : "/"}wizard-vault`;

  beforeEach(() => {
    cy.bridge("close_vault");
    cy.visit("/");
    cy.get("[data-testid=wizard-step-1]", { timeout: 15000 }).should("exist");
  });

  it("explains the vault, then asks which devices you use", () => {
    cy.get("[data-testid=wizard-step-1]").should("contain", "A vault is a folder").and("contain", "Verses become links");
    cy.get("[data-testid=wizard-next]").click();
    cy.get("[data-testid=wizard-step-2]").should("contain", "Which devices");
    cy.get("[data-testid=sync-devices] [data-state=on]").should("have.length", 1);
    cy.get("[data-testid=sync-recommendation]").should("contain", "One device");
    cy.get("[data-testid=wizard-skip]").should("exist");
  });

  it("recommends Syncthing with Android, iCloud for Apple-only, and refuses iOS + Android", () => {
    cy.get("[data-testid=wizard-next]").click();
    cy.get("[data-testid=device-android]").click();
    cy.get("[data-testid=method-syncthing]").should("have.attr", "aria-pressed", "true");
    cy.get("[data-testid=sync-tutorial]").should("contain", "Syncthing").and("contain", "Check that it works");
    cy.get("[data-testid=device-ios]").click();
    cy.get("[data-testid=sync-recommendation]").should("contain", "no free method");
    cy.get("[data-testid=sync-tutorial]").should("not.exist");
    cy.get("[data-testid=device-android]").click();
    // The current device plus iPhone: iCloud unless the current device is Linux.
    cy.get("[data-testid=sync-recommendation]").then(($r) => {
      if (!$r.text().includes("no free method")) {
        cy.get("[data-testid=method-icloud]").should("have.attr", "aria-pressed", "true");
        cy.get("[data-testid=sync-tutorial]").should("contain", "iCloud Drive");
      }
    });
    cy.get("[data-testid=wizard-skip]").should("not.exist");
  });

  it("shows the tutorial in French when the app language is French", () => {
    cy.bridge("set_language", { lang: "fr" });
    cy.visit("/");
    cy.get("[data-testid=wizard-next]").click();
    cy.get("[data-testid=device-android]").click();
    cy.get("[data-testid=sync-tutorial]").should("contain", "Vérifier que ça marche");
    cy.bridge("set_language", { lang: "en" });
  });

  it("creates the vault at the typed path and lands on Home", () => {
    cy.get("[data-testid=wizard-next]").click();
    cy.get("[data-testid=wizard-skip]").click();
    cy.get("[data-testid=wizard-step-3]").should("contain", "Where should the vault live");
    cy.get("[data-testid=vault-path]").invoke("val").should("match", /Synesis$/);
    cy.get("[data-testid=vault-path]").clear().type(newVault());
    cy.get("[data-testid=vault-create]").click();
    cy.get("[data-testid=wizard-step-4]").should("contain", "You're set").and("contain", "Quick capture");
    cy.get("[data-testid=wizard-open]").click();
    cy.get("[data-testid=home-recent]", { timeout: 15000 }).should("exist");
    cy.get("[data-sidebar=header]").should("contain", "wizard-vault");
    cy.task<boolean>("file:exists", `${newVault()}/Notes`).should("equal", true);
    cy.bridge<{ sync_method: string | null }>("get_settings").its("sync_method").should("equal", "none");
  });

  it("Settings shows the sync section, this device, and reopens the setup", () => {
    cy.get("[data-testid=wizard-next]").click();
    cy.get("[data-testid=wizard-skip]").click();
    cy.get("[data-testid=vault-path]").clear().type(newVault());
    cy.get("[data-testid=vault-create]").click();
    cy.get("[data-testid=wizard-open]").click();
    cy.get("[data-testid=nav-settings]", { timeout: 15000 }).click();
    cy.get("[data-testid=settings-sync]").should("contain", "does not sync");
    cy.get("[data-testid=sync-device]").should("have.length", 1).and("contain", "this device");
    cy.get("[data-testid=settings-sync-setup]").click();
    cy.get("[data-testid=sync-dialog] [data-testid=sync-devices]").should("exist");
    cy.get("[data-testid=sync-dialog] [data-testid=device-android]").click();
    cy.get("[data-testid=sync-dialog] [data-testid=sync-tutorial]").should("contain", "Syncthing");
    cy.get("body").type("{esc}");
    cy.bridge<{ sync_method: string | null }>("get_settings").its("sync_method").should("equal", "syncthing");
    cy.get("[data-testid=settings-sync]").should("contain", "Syncthing");
    cy.runCommand("Set up sync");
    cy.get("[data-testid=sync-dialog]").should("exist");
  });
});
