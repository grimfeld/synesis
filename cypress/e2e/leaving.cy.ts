/**
 * Removing a Vault from a Device, and a Device from a Vault (ADR 0014).
 *
 * The bug behind it: a retired phone's snapshots stayed in the Vault's sync
 * folder, so a later pairing round mirrored them onward and documents the Vault
 * no longer had were materialised again. A folder is not a claim.
 */
describe("Leaving a vault", () => {
  const seeded = () => Cypress.env("vault") as string;

  beforeEach(() => cy.openApp());

  afterEach(() => {
    // Whatever a test left open, the rest of the spec expects the seeded vault.
    cy.bridge("open_vault", { path: seeded() });
  });

  it("offers Leave for the open vault, and Forget only for the others", () => {
    cy.get("[data-testid=nav-settings]").click();
    cy.get("[data-testid=settings-vaults]").should("be.visible");
    cy.get("[data-testid=vault-leave]").should("have.length", 1);
  });

  it("leaving without deleting keeps the folder and stops this device syncing", () => {
    cy.task<string>("vault:seed").then((dir) => {
      cy.bridge("open_vault", { path: dir });
      cy.visit("/");
      cy.get("[data-testid=home-recent]", { timeout: 15000 }).should("exist");
      cy.get("[data-testid=nav-settings]").click();

      // This device published snapshots into the vault while it was open.
      cy.bridge<{ id: string; is_self: boolean }[]>("sync_status").then((devices) => {
        const self = devices.find((d) => d.is_self);
        expect(self, "this device is in the vault's sync folder").to.exist;
        cy.get("[data-testid=vault-leave]").click();
        cy.get("[data-testid=vault-leave-confirm]").should("be.visible");
        cy.get("[data-testid=vault-leave-keep]").click();

        // The documents are still there; this device's sync folder is not.
        cy.task<boolean>("file:exists", dir).should("equal", true);
        cy.task<boolean>("file:exists", `${dir}/Notes`).should("equal", true);
        cy.task<boolean>("file:exists", `${dir}/.bible-study/sync/${self!.id}`).should("equal", false);
      });

      // And the vault is no longer listed on this device.
      cy.bridge<{ vaults: { path: string }[] }>("get_settings").then((s) => {
        expect(s.vaults.map((v) => v.path)).to.not.include(dir);
      });
      cy.task("vault:remove", dir);
    });
  });

  it("deleting the documents needs the vault's name typed, and then the folder is gone", () => {
    cy.task<string>("vault:seed").then((dir) => {
      cy.bridge("open_vault", { path: dir });
      cy.visit("/");
      cy.get("[data-testid=home-recent]", { timeout: 15000 }).should("exist");
      cy.get("[data-testid=nav-settings]").click();
      cy.bridge<{ meta: { name: string } }>("vault_info").then((info) => {
        cy.get("[data-testid=vault-leave]").click();
        // Guarded until the name matches exactly.
        cy.get("[data-testid=vault-leave-delete]").should("be.disabled");
        cy.get("[data-testid=vault-leave-name]").type("not the name");
        cy.get("[data-testid=vault-leave-delete]").should("be.disabled");
        cy.get("[data-testid=vault-leave-name]").clear().type(info.meta.name);
        cy.get("[data-testid=vault-leave-delete]").should("not.be.disabled").click();
        cy.task<boolean>("file:exists", dir).should("equal", false);
      });
    });
  });
});

describe("Removing a device from a vault", () => {
  beforeEach(() => cy.openApp());

  /** A folder in `sync/` for a device that is not this one, as a retired phone leaves. */
  const ghost = "01GHOSTDEVICEGHOSTDEVICE00";
  const ghostDir = () => `${Cypress.env("vault")}/.bible-study/sync/${ghost}`;

  it("evicts a device, removes its folder, and does not trust it again", () => {
    cy.task("file:write", {
      path: `${ghostDir()}/device.json`,
      text: JSON.stringify({ name: "Old phone", platform: "android" }),
    });
    cy.bridge("open_vault", { path: Cypress.env("vault") });
    cy.visit("/");
    cy.get("[data-testid=home-recent]", { timeout: 15000 }).should("exist");
    cy.get("[data-testid=nav-settings]").click();

    cy.get("[data-testid=sync-device]").should("contain", "Old phone");
    cy.get("[data-testid=sync-device]")
      .contains("Old phone")
      .parents("[data-testid=sync-device]")
      .find("[data-testid=device-evict]")
      .click();
    cy.get("[data-testid=device-evict-confirm]").should("contain", "Old phone");
    cy.get("[data-testid=device-evict-go]").click();

    // The row and the folder go together, and the documents stay.
    cy.get("[data-testid=sync-device]").should("not.contain", "Old phone");
    cy.task<boolean>("file:exists", ghostDir()).should("equal", false);
    cy.query({ kind: "Documents", args: {} }).should("not.be.empty");

    // It is retired, so a folder that comes back is not trusted again.
    cy.task("file:write", {
      path: `${ghostDir()}/device.json`,
      text: JSON.stringify({ name: "Old phone", platform: "android" }),
    });
    cy.bridge("open_vault", { path: Cypress.env("vault") });
    cy.bridge<{ removed_devices?: string[] }>("pairing_status").then(() => {
      cy.task<boolean>("file:exists", ghostDir()).should("equal", true);
    });
  });

  it("does not offer to evict this device", () => {
    cy.get("[data-testid=nav-settings]").click();
    cy.get("[data-testid=sync-device]").each(($li) => {
      if ($li.text().includes("this device")) {
        expect($li.find("[data-testid=device-evict]")).to.have.length(0);
      }
    });
  });
});
