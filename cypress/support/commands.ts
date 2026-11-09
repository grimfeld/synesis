/// <reference types="cypress" />

declare global {
  namespace Cypress {
    interface Chainable {
      /** Call an engine command through the dev bridge (Node side, no CORS). */
      bridge<T = unknown>(cmd: string, args?: Record<string, unknown>): Chainable<T>;
      /** Ask the index a question, the way the app does (`engine::query`). */
      query<T = unknown>(q: Record<string, unknown>): Chainable<T>;
      /** Open the app on Home with the seeded vault loaded. */
      openApp(): Chainable<void>;
      /** Open the Command Palette (Ctrl/⌘K) and type a query. */
      palette(query: string): Chainable<JQuery<HTMLElement>>;
      /** Navigate to a document by title through the palette. */
      openDoc(title: string): Chainable<void>;
      /** Run a Command by its palette title. */
      runCommand(title: string): Chainable<void>;
      /** Press a shortcut on the body: "{ctrl}k", "{ctrl}e"… */
      shortcut(keys: string): Chainable<void>;
      /** Assert the Hub header shows this title (input for editable pages, heading for Scripture). */
      hubTitle(title: string): Chainable<void>;
      /** Open a Tutorial from the current view's "?" (through its list when the view has several). */
      openTutorial(id: string): Chainable<void>;
      /** Assert the Tutorial panel is on this step (0-based). */
      tutorialStep(index: number): Chainable<void>;
      /** Go to the next step of the open Tutorial. */
      tutorialNext(): Chainable<void>;
      /** Click a Command link in the current step, by Command id. */
      tutorialCommand(id: string): Chainable<void>;
      /** Say the last step is done, and check the Tutorial is finished. */
      tutorialDone(): Chainable<void>;
      /**
       * Answer the Skin gallery's commands from the repo's own `skins/` folder,
       * so no spec reaches GitHub (PLAN §26.11). `fail` makes the index fetch fail.
       */
      stubSkinGallery(opts?: { fail?: boolean }): Chainable<void>;
      /** Find a document summary by title in the engine. */
      docByTitle<T = { id: string; path: string; title: string; type: string }>(title: string): Chainable<T>;
    }
  }
}

const bridge = Cypress.env("bridge") as string;

const invoke = (cmd: string, args: Record<string, unknown> = {}) =>
  cy.request({ method: "POST", url: `${bridge}/invoke/${cmd}`, body: args, headers: { "content-type": "application/json" } }).then((r) => r.body);

/**
 * The commands the support hooks run around a spec, before the test copy is
 * open and after it is let go (cypress/support/e2e.ts). They touch settings,
 * not a Vault's files; every other command is refused unless a test copy is
 * the open Vault.
 */
const AROUND_A_SPEC = new Set([
  "get_settings",
  "set_language",
  "set_map_filters",
  "open_vault",
  "close_vault",
  "forget_vault",
]);

/**
 * Fail the run at once unless the open Vault is a marked test copy
 * (scripts/test-vaults.mjs). The dev app shares the installed app's settings:
 * if it restarts mid-run it reopens the developer's own Vault, and a spec must
 * never write to, or even drive the UI over, one of those. With `orNone`, no
 * Vault open at all also passes (the onboarding wizard's specs close it).
 */
function refuseUnlessTestVault(orNone = false) {
  return invoke("get_settings").then((s: { vault_path: string | null }) =>
    cy.task<string[]>("vault:testVaults", s.vault_path ? [s.vault_path] : []).then((test) => {
      if (test.length > 0 || (orNone && !s.vault_path)) return;
      // Stop the whole run, not only this test: every later spec would meet
      // the same Vault.
      (Cypress as unknown as { stop?: () => void }).stop?.();
      throw new Error(
        `Refusing to run: the open Vault is not a test copy (${s.vault_path ?? "none"}).`,
      );
    }),
  );
}

Cypress.Commands.add("bridge", (cmd, args = {}) => {
  if (AROUND_A_SPEC.has(cmd)) return invoke(cmd, args);
  return refuseUnlessTestVault(true).then(() => invoke(cmd, args));
});

// Every read goes through the one `query` command, so a spec asks the same way
// the app does; `Answer` is a tagged union and the value is what the caller wants.
Cypress.Commands.add("query", (q) =>
  cy.bridge<{ kind: string; value: unknown }>("query", { query: q }).then((a) => a.value),
);

Cypress.Commands.add("openApp", () => {
  refuseUnlessTestVault();
  cy.visit("/");
  cy.get("[data-testid=home-recent]", { timeout: 15000 }).should("exist");
  // Once more with the page up: the app may have restarted while it loaded.
  refuseUnlessTestVault();
});

Cypress.Commands.add("palette", (query) => {
  cy.get("body").type("{ctrl}k");
  cy.get("[data-testid=palette]").should("be.visible");
  return cy.get("[data-testid=palette] input[cmdk-input]").clear().type(query);
});

Cypress.Commands.add("openDoc", (title) => {
  cy.palette(title);
  cy.get("[data-testid=palette] [cmdk-item]").contains(title).click();
  cy.get("[data-testid=palette]").should("not.exist");
});

Cypress.Commands.add("runCommand", (title) => {
  cy.palette(">" + title);
  cy.get("[data-testid=palette] [cmdk-item]").contains(title).click();
  cy.get("[data-testid=palette]").should("not.exist");
});

Cypress.Commands.add("shortcut", (keys) => {
  cy.get("body").type(keys);
});

Cypress.Commands.add("hubTitle", (title) => {
  cy.get("[data-testid=hub-header]").should(($h) => {
    const input = $h.find("[data-testid=doc-title]");
    if (input.length) expect(input.val()).to.equal(title);
    else expect($h.find("h1").text()).to.contain(title);
  });
});

Cypress.Commands.add("docByTitle", (title) =>
  cy.query<{ id: string; path: string; title: string; type: string }[]>({ kind: "list", docType: null }).then((docs) => {
    const d = docs.find((x) => x.title === title);
    expect(d, `document "${title}"`).to.exist;
    return d!;
  }),
);

export {};

Cypress.Commands.add("openTutorial", (id) => {
  cy.get("[data-testid=tutorial-button]").first().click();
  cy.get("[data-testid=tutorial-panel]").should("be.visible");
  cy.get("[data-testid=tutorial-panel]").then(($p) => {
    if ($p.find("[data-testid=tutorial-list]").length) cy.get(`[data-testid=tutorial-list-item][data-id="${id}"]`).click();
  });
  cy.get("[data-testid=tutorial-body]").should("have.attr", "data-id", id);
});

Cypress.Commands.add("tutorialStep", (index) => {
  cy.get(`[data-testid=tutorial-step][data-index=${index}]`).should("have.attr", "data-current", "true");
});

Cypress.Commands.add("tutorialNext", () => {
  cy.get("[data-testid=tutorial-next]").click();
});

Cypress.Commands.add("tutorialCommand", (id) => {
  cy.get(`[data-testid=tutorial-step][data-current=true] [data-testid=command-link][data-command="${id}"]`).first().should("have.attr", "data-available", "true").click();
});

Cypress.Commands.add("tutorialDone", () => {
  cy.get("[data-testid=tutorial-done]").click();
  cy.get("[data-testid=tutorial-again]").should("exist");
});

Cypress.Commands.add("stubSkinGallery", (opts = {}) => {
  if (opts.fail) {
    cy.intercept("POST", "**/invoke/skin_gallery", { statusCode: 500, body: { error: "offline" } }).as("skinGallery");
    return;
  }
  cy.readFile<{ skins: { file: string }[] }>("skins/index.json").then((index) => {
    const files: Record<string, unknown> = {};
    for (const s of index.skins) cy.readFile(`skins/${s.file}`).then((skin) => (files[s.file] = skin));
    cy.intercept("POST", "**/invoke/skin_gallery", { body: index }).as("skinGallery");
    cy.intercept("POST", "**/invoke/gallery_skin", (req) => {
      const skin = files[(req.body as { file: string }).file];
      req.reply(skin ? { body: skin } : { statusCode: 500, body: { error: "not in the gallery" } });
    }).as("gallerySkin");
  });
});
