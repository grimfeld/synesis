// Walks the Updates Tutorial (docs/tutorials/updates.en.md) step by step, so a
// change to the updater's UI that outdates the Tutorial fails here (PLAN
// §25.13). The updater plugin is stubbed as in cypress/e2e/updater.cy.ts: the
// dev bridge answers `plugin:` calls with null, so `check` is made to report
// a fake release and nothing is downloaded or restarted.
type Invoke = (cmd: string, args?: Record<string, unknown>, options?: unknown) => Promise<unknown>;

describe("Tutorial: Updates", () => {
  beforeEach(() => cy.openApp());

  it("can be followed to the end", () => {
    cy.window().then((win) => {
      const internals = (win as unknown as { __TAURI_INTERNALS__: { invoke: Invoke } }).__TAURI_INTERNALS__;
      const real = internals.invoke.bind(internals);
      internals.invoke = async (cmd, args, options) => {
        if (cmd === "plugin:updater|check")
          return { rid: 1, currentVersion: "0.0.1", version: "99.0.0", date: null, body: "", rawJson: {} };
        if (cmd.startsWith("plugin:updater|") || cmd.startsWith("plugin:process|")) return null;
        return real(cmd, args, options);
      };
    });
    cy.get("[data-testid=nav-settings]").click();
    cy.openTutorial("updates");

    // 1. Settings > Updates: the version and the automatic-check switch.
    cy.tutorialStep(0);
    cy.tutorialCommand("nav.settings");
    cy.get("[data-testid=settings-updates]").scrollIntoView().should("be.visible");
    cy.get("[data-testid=updates-current]").invoke("text").should("match", /\d+\.\d+\.\d+/);
    cy.get("[data-testid=updates-auto]").should("exist");
    cy.tutorialNext();

    // 2. The banner and its two buttons (seen in step 3, once a check finds one).
    cy.tutorialStep(1);
    cy.tutorialNext();

    // 3. Do it once: Check for updates offers the new version.
    cy.tutorialStep(2);
    cy.tutorialCommand("app.check_updates");
    cy.get("[data-testid=update-banner]").should("contain", "99.0.0");
    cy.get("[data-testid=update-install]").should("be.visible");
    cy.get("[data-testid=update-dismiss]").click();
    cy.get("[data-testid=update-banner]").should("not.exist");
    cy.get("[data-testid=updates-install]").should("be.visible");
    cy.tutorialDone();
  });
});
