// Walks every folder-sync Tutorial (docs/tutorials/sync-<method>.<kind>.en.md)
// step by step (PLAN §25.13). Settings' "?" lists the variants for this
// Device's kind, read from `sync_locations`, so each kind's walk stubs that
// answer's platform and checks the list is exactly that kind's variants.
// Syncing needs a second device and a third-party tool, so the walk checks
// what one machine can: every step is reachable, every Command link in the
// steps is live, and the do-it-once step's Quick capture makes the test Note.

/** Each Device kind, the platform `sync_locations` names it by, and its variants in list order. */
const KINDS: { kind: string; platform: string; ids: string[] }[] = [
  { kind: "mac", platform: "macos", ids: ["sync-icloud.mac", "sync-syncthing.mac", "sync-provider.mac"] },
  { kind: "windows", platform: "windows", ids: ["sync-syncthing.windows", "sync-provider.windows"] },
  { kind: "linux", platform: "linux", ids: ["sync-syncthing.linux", "sync-provider.linux"] },
  { kind: "ios", platform: "ios", ids: ["sync-icloud.ios"] },
  { kind: "android", platform: "android", ids: ["sync-syncthing.android"] },
];

describe("Tutorial: Folder sync", () => {
  /**
   * Open Settings' "?" list once it offers this Device's sync Tutorials: the
   * Device kind comes from `sync_locations`, which Settings asks for on mount,
   * and the list is built when the "?" is clicked.
   */
  function openSettingsList(tries = 10): void {
    cy.get("[data-testid=tutorial-button]").first().click();
    cy.get("[data-testid=tutorial-list]").then(($list) => {
      if (
        $list.find('[data-testid=tutorial-list-item][data-id^="sync-"]')
          .length ||
        tries <= 0
      )
        return;
      cy.get("[data-testid=tutorial-close]").click();
      cy.wait(300);
      openSettingsList(tries - 1);
    });
  }

  function walk(id: string): void {
    cy.get("[data-testid=nav-settings]").click();
    cy.openTutorial(id);
    cy.get("[data-testid=tutorial-step]").then(($steps) => {
      const total = $steps.length;
      expect(total, `${id} steps`).to.be.within(3, 6);
      for (let i = 0; i < total; i++) {
        cy.tutorialStep(i);
        // Every Command a step names is one the app can run from here.
        cy.get(`[data-testid=tutorial-step][data-index=${i}]`).then(($step) => {
          $step.find("[data-testid=command-link]").each((_, link) => {
            expect(
              link.getAttribute("data-available"),
              `${id} step ${i + 1}: ${link.getAttribute("data-command")}`,
            ).to.equal("true");
          });
        });
        if (i < total - 1) cy.tutorialNext();
      }
      // The do-it-once step: this device's half of it, the test Note.
      cy.tutorialCommand("create.quick");
      cy.get("[role=dialog] textarea").type(
        "sync test from this device{ctrl}{enter}",
      );
      cy.get(".cm-content").should("contain", "sync test from this device");
      cy.get("[data-testid=tutorial-panel]").should("be.visible");
      cy.tutorialDone();
    });
  }

  for (const { kind, platform, ids } of KINDS)
    it(`can be followed to the end on ${kind}`, () => {
      // Only the platform changes: the rest of the answer is this machine's.
      cy.intercept("POST", "**/invoke/sync_locations", (req) =>
        req.continue((res) => {
          res.body = { ...res.body, platform };
        }),
      );
      cy.openApp();
      cy.get("[data-testid=nav-settings]").click();
      openSettingsList();
      cy.get('[data-testid=tutorial-list-item][data-id^="sync-"]').should(($items) => {
        expect([...$items].map((el) => el.getAttribute("data-id"))).to.deep.equal(ids);
      });
      cy.get("[data-testid=tutorial-close]").click();
      for (const id of ids) walk(id);
    });
});
