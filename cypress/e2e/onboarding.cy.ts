describe("Onboarding wizard", () => {
  const newVault = () => `${Cypress.env("vault")}${Cypress.platform === "win32" ? "\\" : "/"}wizard-vault`;

  beforeEach(() => {
    cy.bridge("close_vault");
    cy.visit("/");
    cy.get("[data-testid=wizard-step-1]", { timeout: 15000 }).should("exist");
  });

  it("explains the vault, then offers three ways in and nothing else", () => {
    cy.get("[data-testid=wizard-step-1]").should("contain", "A vault is a folder").and("contain", "Verses become links");
    cy.get("[data-testid=wizard-next]").click();
    cy.get("[data-testid=wizard-step-2]").should("contain", "How do you want to start?");
    cy.get("[data-testid=route-pairing]").should("exist");
    cy.get("[data-testid=route-folder]").should("exist");
    cy.get("[data-testid=route-local]").should("exist");
    // The bug this replaces: a Next button that ignored the pairing code and
    // made a local vault instead. There is nothing on the chooser to press but
    // a card, so no button can mean something other than the one being read.
    cy.get("[data-testid=wizard-step-2] [data-testid=wizard-next]").should("not.exist");
    cy.get("[data-testid=wizard-skip]").should("not.exist");
  });

  it("goes to the route you tapped, and Back returns to the chooser", () => {
    cy.get("[data-testid=wizard-next]").click();
    cy.get("[data-testid=route-pairing]").click();
    cy.get("[data-testid=route-screen-pairing]").should("exist");
    cy.get("[data-testid=pairing-join-go]").should("be.disabled");
    cy.contains("button", "Back").click();
    cy.get("[data-testid=wizard-routes]").should("exist");
    cy.get("[data-testid=route-local]").click();
    cy.get("[data-testid=route-screen-local]").should("exist");
  });

  it("names the vault on the pairing screen, without asking for a folder", () => {
    cy.get("[data-testid=wizard-next]").click();
    cy.get("[data-testid=route-pairing]").click();
    // The path field is gone: the Invite says which vault this is, and the
    // folder follows from its name (ADR 0015).
    cy.get("[data-testid=pairing-join-path]").should("not.exist");
    cy.get("[data-testid=pairing-join-code]").type("synesis:notreallyacode");
    cy.get("[data-testid=pairing-join-go]").should("be.enabled");
  });

  it("recommends Syncthing with Android, iCloud for Apple-only, and refuses iOS + Android", () => {
    cy.get("[data-testid=wizard-next]").click();
    cy.get("[data-testid=route-folder]").click();
    cy.get("[data-testid=device-android]").click();
    cy.get("[data-testid=method-syncthing]").should("have.attr", "aria-pressed", "true");
    cy.get("[data-testid=sync-tutorial]").should("contain", "Syncthing").and("contain", "Try it once");
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
  });

  it("shows the tutorial in French when the app language is French", () => {
    cy.bridge("set_language", { lang: "fr" });
    cy.visit("/");
    cy.get("[data-testid=wizard-next]").click();
    cy.get("[data-testid=route-folder]").click();
    cy.get("[data-testid=device-android]").click();
    cy.get("[data-testid=sync-tutorial]").should("contain", "Essayez une fois");
    cy.bridge("set_language", { lang: "en" });
  });

  it("creates the vault at the typed path and lands on Home", () => {
    cy.get("[data-testid=wizard-next]").click();
    cy.get("[data-testid=route-local]").click();
    cy.get("[data-testid=route-screen-local]").should("contain", "Start a vault on this device");
    // Desktop keeps the picker and the path field; only mobile derives it.
    cy.get("[data-testid=vault-path]").invoke("val").should("match", /Synesis/);
    cy.get("[data-testid=vault-path]").clear().type(newVault());
    cy.get("[data-testid=vault-create]").click();
    cy.get("[data-testid=home-recent]", { timeout: 15000 }).should("exist");
    cy.get("[data-sidebar=header]").should("contain", "wizard-vault");
    cy.task<boolean>("file:exists", `${newVault()}/Notes`).should("equal", true);
    cy.bridge<{ sync_method: string | null }>("get_settings").its("sync_method").should("equal", "none");
  });

  it("lists the vaults this device holds instead of the pillars", () => {
    // Made one above; reopening it should not be a four-step wizard (PLAN §21.7).
    cy.bridge<{ vaults: { id: string }[] }>("get_settings").then((s) => {
      if (s.vaults.length === 0) return;
      cy.visit("/");
      cy.get("[data-testid=known-vaults]", { timeout: 15000 }).should("exist");
      cy.get("[data-testid=wizard-step-1]").should("contain", "Your vaults");
      cy.get("[data-testid=known-vaults] button").first().click();
      cy.get("[data-testid=home-recent]", { timeout: 15000 }).should("exist");
    });
  });

  it("Settings shows the sync section, this device, and reopens the setup", () => {
    cy.get("[data-testid=wizard-next]").click();
    cy.get("[data-testid=route-local]").click();
    cy.get("[data-testid=vault-path]").clear().type(newVault());
    cy.get("[data-testid=vault-create]").click();
    cy.get("[data-testid=nav-settings]", { timeout: 15000 }).click();
    cy.get("[data-testid=settings-sync]").should("contain", "does not sync");
    cy.get("[data-testid=sync-device]").should("have.length", 1).and("contain", "this device");
    // Settings keeps today's panel: it opens with a vault already open, where
    // "create a local vault" would mean nothing (PLAN §21.10).
    cy.get("[data-testid=settings-sync-setup]").click();
    cy.get("[data-testid=sync-dialog] [data-testid=sync-pairing]").should("exist");
    cy.get("[data-testid=sync-dialog] [data-testid=sync-folders-toggle]").click();
    cy.get("[data-testid=sync-dialog] [data-testid=device-android]").click();
    cy.get("[data-testid=sync-dialog] [data-testid=sync-tutorial]").should("contain", "Syncthing");
    cy.get("body").type("{esc}");
    cy.bridge<{ sync_method: string | null }>("get_settings").its("sync_method").should("equal", "syncthing");
    cy.get("[data-testid=settings-sync]").should("contain", "Syncthing");
    cy.runCommand("Set up sync");
    cy.get("[data-testid=sync-dialog]").should("exist");
  });
});

describe("Onboarding on a phone", () => {
  // The dev bridge runs the desktop build, so the Android shape is served by
  // intercepting the one command that carries it. The UI branches on nothing
  // else, which is why the platform lives in a single answer.
  const android = (granted: boolean) => ({
    platform: "android",
    home: granted
      ? "/storage/emulated/0/Documents/Synesis"
      : "/storage/emulated/0/Android/data/tech.grimfeld.synesis/files/Documents/Synesis",
    can_pick_folder: false,
    app_decides_path: true,
    storage: { needed: true, granted },
    locations: [],
    found: [],
  });

  const phone = (granted: boolean) => {
    cy.intercept("POST", "**/invoke/sync_locations", { body: android(granted) }).as("locations");
    cy.intercept("POST", "**/invoke/storage_access", { body: { needed: true, granted } });
    cy.bridge("close_vault");
    cy.viewport(390, 844);
    cy.visit("/");
    cy.wait("@locations");
  };

  it("asks for a name, not a folder, and says where the vault will go", () => {
    phone(true);
    cy.get("[data-testid=wizard-next]", { timeout: 15000 }).click();
    cy.get("[data-testid=route-local]").click();
    cy.get("[data-testid=vault-name]").should("exist");
    cy.get("[data-testid=vault-path]").should("not.exist");
    cy.get("[data-testid=vault-name]").clear().type("Study");
    cy.get("[data-testid=lands-path]").should("contain", "/storage/emulated/0/Documents/Synesis/Study");
    cy.get("[data-testid=lands-in]").should("contain", "Obsidian can open the vault");
    cy.get("[data-testid=grant-access]").should("not.exist");
  });

  it("says the folder is hidden, and offers to ask, when access was refused", () => {
    phone(false);
    cy.get("[data-testid=wizard-next]", { timeout: 15000 }).click();
    cy.get("[data-testid=route-local]").click();
    cy.get("[data-testid=lands-path]").should("contain", "Android/data/");
    cy.get("[data-testid=lands-in]").should("contain", "hidden from the Files app");
    cy.get("[data-testid=grant-access]").should("exist");
    // Refusing never blocks: the vault is still made, somewhere the user was
    // told about (ADR 0015).
    cy.get("[data-testid=vault-create]").should("not.be.disabled");
  });
});
