/// <reference types="cypress" />
import "./commands";

// Each spec gets a fresh copy of the demo vault opened through the engine's
// dev bridge; the vault that was open before the spec is reopened afterwards.
let original: string | null = null;
let originalLang = "en";
let vault = "";

before(() => {
  cy.bridge<{ vault_path: string | null; lang: string }>("get_settings").then((s) => {
    original = s.vault_path;
    originalLang = s.lang;
  });
  cy.task<string>("vault:seed").then((dir) => {
    vault = dir;
    Cypress.env("vault", dir);
    cy.bridge("open_vault", { path: dir });
  });
});

after(() => {
  cy.bridge("set_language", { lang: originalLang });
  if (original && original !== vault) cy.bridge("open_vault", { path: original });
  cy.task("vault:remove", vault);
});

// The app forwards console errors to the terminal; fail fast on any of them.
Cypress.on("window:before:load", (win) => {
  cy.stub(win.console, "error").callsFake((...args: unknown[]) => {
    const text = args.map(String).join(" ");
    // Leaflet tile fetches are blocked offline; not an app error.
    if (/tile\.openstreetmap\.org|Failed to load resource/.test(text)) return;
    throw new Error("console.error: " + text);
  });
});
