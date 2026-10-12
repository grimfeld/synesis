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
  // Specs assert English strings; the app may have been left in another language.
  cy.bridge("set_language", { lang: "en" });
  cy.task<string>("vault:seed").then((dir) => {
    vault = dir;
    Cypress.env("vault", dir);
    cy.bridge("open_vault", { path: dir });
  });
});

after(() => {
  cy.bridge("set_language", { lang: originalLang });
  // Let go of the copy first: its index cannot be removed while it is open.
  if (original && !original.includes("synesis-cy-")) cy.bridge("open_vault", { path: original });
  else cy.bridge("close_vault");
  // Every copy the app has listed, this spec's and any a crashed run left
  // (a spec's second copy, the onboarding's wizard-vault inside one): forget
  // it, so the vault list holds the user's vaults only, and remove it.
  cy.bridge<{ vaults: { id: string; path: string }[] }>("get_settings").then((s) => {
    for (const v of s.vaults.filter((v) => v.path.includes("synesis-cy-"))) {
      cy.bridge("forget_vault", { id: v.id });
      cy.task("vault:remove", v.path);
    }
  });
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
