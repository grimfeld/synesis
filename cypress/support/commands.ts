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
      /** Find a document summary by title in the engine. */
      docByTitle<T = { id: string; path: string; title: string; type: string }>(title: string): Chainable<T>;
    }
  }
}

const bridge = Cypress.env("bridge") as string;

Cypress.Commands.add("bridge", (cmd, args = {}) =>
  cy.request({ method: "POST", url: `${bridge}/invoke/${cmd}`, body: args, headers: { "content-type": "application/json" } }).then((r) => r.body),
);

// Every read goes through the one `query` command, so a spec asks the same way
// the app does; `Answer` is a tagged union and the value is what the caller wants.
Cypress.Commands.add("query", (q) =>
  cy.bridge<{ kind: string; value: unknown }>("query", { query: q }).then((a) => a.value),
);

Cypress.Commands.add("openApp", () => {
  cy.visit("/");
  cy.get("[data-testid=home-recent]", { timeout: 15000 }).should("exist");
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
  cy.query<{ id: string; path: string; title: string; type: string }[]>({ kind: "list", docType: null }).then((docs) => {
    const d = docs.find((x) => x.title === title);
    expect(d, `document "${title}"`).to.exist;
    return d!;
  }),
);

export {};
