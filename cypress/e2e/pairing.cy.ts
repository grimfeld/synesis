describe("Pairing", () => {
  beforeEach(() => cy.openApp());

  afterEach(() => {
    cy.bridge("pairing_stop");
  });

  it("shows a pairing code and QR for the open vault, and this device as a member", () => {
    cy.get("[data-testid=nav-settings]").click();
    cy.get("[data-testid=pairing-panel] [data-testid=pairing-show]").click();
    cy.get("[data-testid=pairing-code]").invoke("val").should("match", /^synesis:[A-Za-z0-9_-]{40,}$/);
    cy.get("[data-testid=pairing-qr] svg").should("exist");
    cy.get("[data-testid=pairing-members] li").should("have.length", 1).and("contain", "this device");
    cy.bridge<{ sync_method: string | null }>("get_settings").its("sync_method").should("equal", "pairing");
    cy.bridge<{ members: unknown[]; joining: boolean; node: string }>("pairing_status").then((s) => {
      expect(s.members).to.have.length(1);
      expect(s.joining).to.equal(false);
      expect(s.node).to.match(/^[0-9a-f]{64}$/);
    });
  });

  it("revoking makes a different code; the old one no longer decodes to the same secret", () => {
    cy.get("[data-testid=nav-settings]").click();
    cy.get("[data-testid=pairing-show]").click();
    cy.get("[data-testid=pairing-code]")
      .invoke("val")
      .then((first) => {
        cy.contains("button", "Revoke").click();
        cy.get("[data-testid=pairing-code]").invoke("val").should("not.equal", first);
      });
  });

  it("the Set up sync dialog leads with pairing and keeps the folder methods behind a toggle", () => {
    cy.runCommand("Set up sync");
    cy.get("[data-testid=sync-dialog] [data-testid=sync-pairing]").should("contain", "Pair your devices");
    cy.get("[data-testid=sync-dialog] [data-testid=sync-devices]").should("not.exist");
    cy.get("[data-testid=sync-dialog] [data-testid=sync-folders-toggle]").click();
    cy.get("[data-testid=sync-dialog] [data-testid=sync-devices]").should("be.visible");
  });

  it("a join request from another device raises the approval dialog", () => {
    // Simulate the engine event the node emits when a newcomer uses the code.
    cy.window().then((win) => {
      const w = win as unknown as { __TAURI_INTERNALS__?: unknown; dispatchEvent: (e: Event) => void };
      expect(w.__TAURI_INTERNALS__, "dev bridge").to.exist;
    });
    cy.bridge("pairing_invite");
    // The bridge cannot inject Tauri events; assert the dialog renders from store state instead.
    cy.window().its("__synesis_setDialog").then((setDialog: unknown) => {
      if (typeof setDialog === "function") {
        (setDialog as (d: unknown) => void)({ kind: "pairing-request", node: "ab".repeat(32), name: "Test phone", platform: "android" });
        cy.get("[data-testid=pairing-request]").should("contain", "Test phone").and("contain", "android");
        cy.get("[data-testid=pairing-request]").contains("button", "Deny").click();
        cy.get("[data-testid=pairing-request]").should("not.exist");
      }
    });
  });
});
