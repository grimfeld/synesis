/// <reference types="cypress" />

declare global {
  namespace Cypress {
    interface Chainable {
      /** Call an engine command through the dev bridge (Node side, no CORS). */
      bridge<T = unknown>(cmd: string, args?: Record<string, unknown>): Chainable<T>;
      /**
       * Open the app on Home with the seeded vault loaded. The first call in a
       * spec loads the page; later calls reset it in place (close overlays, go
       * Home) instead of reloading, which is what made the suite slow.
       */
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
      /** Find a document summary by title in the engine. */
      docByTitle<T = { id: string; path: string; title: string; type: string }>(title: string): Chainable<T>;
    }
  }
}

const bridge = Cypress.env("bridge") as string;

Cypress.Commands.add("bridge", (cmd, args = {}) =>
  cy.request({ method: "POST", url: `${bridge}/invoke/${cmd}`, body: args, headers: { "content-type": "application/json" } }).then((r) => r.body),
);

// Whether the page under test is loaded and healthy. Cleared per spec (this
// module is re-evaluated for every spec) and after a failed test, so the next
// test starts from a fresh page load rather than from whatever state the
// failure left behind. Requires `testIsolation: false` (cypress.config.ts).
let booted = false;
export const forceReload = () => {
  booted = false;
};

Cypress.Commands.add("openApp", () => {
  if (!booted) {
    booted = true;
    cy.visit("/");
    cy.get("[data-testid=home-recent]", { timeout: 15000 }).should("exist");
    return;
  }
  // Close whatever the previous test left open (dialog, palette, menu, sheet,
  // autocomplete), then go Home through the palette: it works on every
  // viewport, unlike the sidebar nav which is a sheet on phones.
  cy.get("body").type("{esc}{esc}");
  cy.runCommand("Go to Home");
  cy.get("[data-testid=home-recent]").should("exist");
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
    const input = $h.find("input[aria-label=Title]");
    if (input.length) expect(input.val()).to.equal(title);
    else expect($h.find("h1").text()).to.contain(title);
  });
});

Cypress.Commands.add("docByTitle", (title) =>
  cy.bridge<{ id: string; path: string; title: string; type: string }[]>("list_documents", {}).then((docs) => {
    const d = docs.find((x) => x.title === title);
    expect(d, `document "${title}"`).to.exist;
    return d!;
  }),
);

export {};
