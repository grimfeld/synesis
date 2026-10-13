// The desktop auto-updater and the About card (src/lib/updater.ts,
// SettingsView). The dev bridge answers every `plugin:` call with null, so
// the updater and process plugins are stubbed here by wrapping the page's
// `invoke`: `check` reports a fake release, and the download and the restart
// are only recorded. Nothing is downloaded and the app never restarts.
type Invoke = (cmd: string, args?: Record<string, unknown>, options?: unknown) => Promise<unknown>;

const FAKE = "99.0.0";

/** Make `plugin:updater|check` find FAKE (or nothing) and record the plugin calls. */
function stubUpdater(found: boolean) {
  cy.window().then((win) => {
    const internals = (win as unknown as { __TAURI_INTERNALS__: { invoke: Invoke } }).__TAURI_INTERNALS__;
    const real = internals.invoke.bind(internals);
    const calls: string[] = [];
    (win as unknown as { __updaterCalls: string[] }).__updaterCalls = calls;
    internals.invoke = async (cmd, args, options) => {
      if (cmd.startsWith("plugin:updater|") || cmd.startsWith("plugin:process|")) calls.push(cmd);
      if (cmd === "plugin:updater|check")
        return found
          ? { rid: 1, currentVersion: "0.0.1", version: FAKE, date: null, body: "Notes", rawJson: {} }
          : null;
      if (cmd === "plugin:updater|download_and_install" || cmd === "plugin:process|restart") return null;
      return real(cmd, args, options);
    };
  });
}

const calls = () => cy.window().its("__updaterCalls");

describe("Updates", () => {
  beforeEach(() => cy.openApp());

  it("Settings shows this version and checks on demand", () => {
    stubUpdater(false);
    cy.get("[data-testid=nav-settings]").click();
    cy.get("[data-testid=settings-updates]").scrollIntoView().should("be.visible");
    cy.get("[data-testid=updates-current]").invoke("text").should("match", /\d+\.\d+\.\d+/);
    cy.get("[data-testid=updates-check]").click();
    cy.get("[data-testid=updates-status]").should("have.attr", "data-status", "current");
    cy.get("[data-testid=update-banner]").should("not.exist");
  });

  it("an update found raises the banner, and Install & restart installs then relaunches", () => {
    stubUpdater(true);
    cy.runCommand("Check for updates");
    cy.get("[data-testid=update-banner]").should("be.visible");
    cy.get("[data-testid=update-banner-text]").should("contain", FAKE);
    cy.get("[data-testid=updates-status]").should("have.attr", "data-status", "available");
    cy.get("[data-testid=update-install]").click();
    calls().should("include", "plugin:updater|download_and_install").and("include", "plugin:process|restart");
  });

  it("Later hides the banner but Settings still offers the update", () => {
    stubUpdater(true);
    cy.get("[data-testid=nav-settings]").click();
    cy.get("[data-testid=updates-check]").scrollIntoView().click();
    cy.get("[data-testid=update-banner]").should("be.visible");
    cy.get("[data-testid=update-dismiss]").click();
    cy.get("[data-testid=update-banner]").should("not.exist");
    cy.get("[data-testid=updates-install]").should("be.visible");
  });

  it("the automatic check is a Device setting that survives a reload", () => {
    cy.get("[data-testid=nav-settings]").click();
    cy.get("[data-testid=updates-auto]").scrollIntoView().should("have.attr", "data-state", "checked").click();
    cy.get("[data-testid=updates-auto]").should("have.attr", "data-state", "unchecked");
    cy.bridge<{ check_updates: boolean }>("get_settings").its("check_updates").should("eq", false);
    // Put it back: specs must leave Device settings as they found them.
    cy.bridge("set_check_updates", { enabled: true });
  });
});

describe("About", () => {
  beforeEach(() => cy.openApp());

  it("says Synesis is AGPL free software, links its source and licence, and credits the bundled data", () => {
    cy.runCommand("About Synesis");
    cy.get("[data-testid=settings-about]").should("be.visible");
    cy.get("[data-testid=about-licence]").should("contain", "AGPL");
    cy.get("[data-testid=about-source]").should("have.attr", "href", "https://github.com/grimfeld/synesis");
    cy.get("[data-testid=about-licence-text]").should("have.attr", "href").and("contain", "LICENSE");
    cy.get("[data-testid=about-data]").should("contain", "OpenBible.info").and("contain", "Natural Earth").and("contain", "Mapzen");
  });

  it("shows the third-party notices of the packages Synesis ships", () => {
    cy.runCommand("About Synesis");
    cy.get("[data-testid=about-third-party]").click();
    cy.get("[data-testid=third-party-text]", { timeout: 15000 })
      .should("contain", "@codemirror/view")
      .and("contain", "tauri")
      .and("contain", "Permission is hereby granted");
  });
});
