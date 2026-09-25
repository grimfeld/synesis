// Locale layout: French strings are much longer than English ones, so a card or a
// button that cannot shrink pushes its container past the screen and the app clips
// the overflow (Card is overflow-hidden). Every view must stay inside its box in
// every language, at phone width as well as on a desktop window.
import { expectNoOverflow } from "../support/layout";

const LANGS = ["en", "fr"] as const;

describe("Locale layout", () => {
  // Every other spec asserts English strings, so never leave the app in French.
  afterEach(() => cy.bridge("set_language", { lang: "en" }));

  for (const lang of LANGS) {
    describe(lang, () => {
      beforeEach(() => {
        cy.bridge("set_language", { lang });
        cy.viewport(390, 844);
        cy.openApp();
      });

      it("keeps Settings inside its cards on a phone", () => {
        cy.get("[data-sidebar=trigger]").first().click();
        cy.get("[data-testid=nav-settings]").click();
        cy.get("[data-testid=settings-sync]").should("be.visible");
        expectNoOverflow();
      });

      // "Quitter et supprimer les documents" on a 390px phone is the longest
      // button label in the app, and it sits in a dialog rather than a card.
      // "Naissance"/"Mort" put a label beside a field on a 390px screen, and
      // the New dialog sets the pair in a two-column grid. The Character is
      // made through the engine rather than the palette: a spec should not
      // have to know what the Command is called in each language.
      it("keeps a Character's Span inside its row and its dialog", () => {
        cy.bridge("create_document", {
          docType: "character",
          title: "Jael",
          fields: {},
        });
        cy.openApp();
        cy.get("[data-sidebar=trigger]").first().click();
        cy.get("[data-testid=group-character]").click();
        cy.contains("[data-sidebar=content] a, [data-sidebar=content] button", "Jael").click();
        cy.get("[data-testid=date-input-born]").should("be.visible");
        expectNoOverflow();
      });

      it("keeps the Leave dialog inside the screen", () => {
        cy.get("[data-sidebar=trigger]").first().click();
        cy.get("[data-testid=nav-settings]").click();
        cy.get("[data-testid=vault-leave]").click();
        cy.get("[data-testid=vault-leave-confirm]").should("be.visible");
        expectNoOverflow();
      });

      // The seeded vault has no other Device, so one is planted: the dialog's
      // label is long in French and it is the only place it is seen.
      it("keeps the evict-device dialog inside the screen", () => {
        const dir = `${Cypress.env("vault")}/.bible-study/sync/01LOCALESGHOSTDEVICE00000`;
        cy.task("file:write", {
          path: `${dir}/device.json`,
          text: JSON.stringify({ name: "Ancien téléphone", platform: "android" }),
        });
        cy.bridge("open_vault", { path: Cypress.env("vault") });
        cy.visit("/");
        cy.get("[data-testid=home-recent]", { timeout: 15000 }).should("exist");
        cy.get("[data-sidebar=trigger]").first().click();
        cy.get("[data-testid=nav-settings]").click();
        cy.get("[data-testid=device-evict]").first().click();
        cy.get("[data-testid=device-evict-confirm]").should("be.visible");
        expectNoOverflow();
      });

      it("keeps the Pairing panel inside its card once a code is shown", () => {
        cy.get("[data-sidebar=trigger]").first().click();
        cy.get("[data-testid=nav-settings]").click();
        cy.get("[data-testid=pairing-show]").click();
        cy.get("[data-testid=pairing-qr]", { timeout: 10000 }).should("be.visible");
        expectNoOverflow();
      });

      it("keeps every view inside the screen", () => {
        for (const view of ["home", "timeline", "coverage", "graph", "library", "clippings", "map"]) {
          cy.get("[data-sidebar=trigger]").first().click();
          cy.get(`[data-testid=nav-${view}]`).click();
          cy.get("[data-sidebar=sidebar][data-mobile=true]").should("not.exist");
          expectNoOverflow();
        }
      });

      it("keeps a document and its side panel inside the screen", () => {
        cy.get("[data-sidebar=trigger]").first().click();
        cy.get("[data-testid=group-note]").click();
        cy.get("[data-testid=doc-item]").first().click();
        cy.get(".cm-content", { timeout: 10000 }).should("exist");
        expectNoOverflow();
        cy.get("[data-testid=toggle-panel]").click();
        cy.get("[data-testid=right-panel]").should("be.visible");
        expectNoOverflow();
      });

      it("keeps the Board toolbar inside the screen", () => {
        // The mode toggle carries a word, not just an icon, and "Disposition"
        // is half again as long as "Arranging".
        cy.openDoc("Talk on endurance");
        cy.get("[data-testid=tab-board]").click();
        cy.get("[data-testid=board-canvas]").should("exist");
        expectNoOverflow();
        cy.get("[data-testid=board-mode]").click();
        expectNoOverflow();
      });

      it("hides Split on a phone and keeps the tabs in the header", () => {
        // Two sides of 320px do not fit a 390px phone (PLAN §22.5).
        cy.openDoc("Talk on endurance");
        cy.get("[data-testid=tab-board]").should("exist");
        cy.get("[data-testid=tab-split]").should("not.exist");
        expectNoOverflow();
      });

      it("keeps the header and both sides of a split inside a desktop window", () => {
        // "Côte à côte" is the longest tab, next to "Discours" and "Tableau".
        cy.viewport(1280, 720);
        cy.openDoc("Talk on endurance");
        cy.get("[data-sidebar=trigger]").first().click();
        cy.get("[data-testid=tab-split]").click();
        cy.get("[data-testid=split-board] [data-testid=board-canvas]").should("exist");
        expectNoOverflow();
        // The narrowest a split gets: the side panel open beside it.
        cy.get("[data-testid=right-panel]").then(($p) => {
          if (!$p.is(":visible")) cy.get("[data-testid=toggle-panel]").click();
        });
        expectNoOverflow();
      });

      it("keeps the Delivery view's bar inside a phone", () => {
        // "Réinitialiser", "Quitter" and the timer share one wrapping row.
        cy.openDoc("Talk on endurance");
        cy.get("[data-testid=deliver]").click();
        cy.get("[data-testid=delivery-timer]").should("be.visible");
        expectNoOverflow();
        cy.get("[data-testid=delivery-exit]").click();
      });

      it("keeps a Composition's header inside a phone in Reading mode", () => {
        // A Composition's header carries the most controls: the tabs, Deliver
        // and the lock beside the editor's own.
        cy.openDoc("Talk on endurance");
        cy.get("[data-testid=reading-toggle]").click();
        expectNoOverflow();
        cy.get("[data-testid=reading-toggle]").click();
      });

      it("keeps a Hub's Events list, Dates included, inside the screen", () => {
        // An Event row carries its Date after the title; a span such as
        // "1034 BCE – 1027 BCE" is the longest row the demo vault produces.
        cy.openDoc("Jerusalem");
        cy.get("[data-testid=hub-events] [data-testid=event-date]").should("have.length.greaterThan", 3);
        expectNoOverflow();
      });

      it("keeps Unlinked mentions and Linkables inside the screen", () => {
        // "Mentions non liées" and its hint are the longest strings either
        // section carries, and the rows end in a Link button that must not
        // push the excerpt out of the panel.
        cy.openDoc("Antioch");
        cy.get("[data-testid=unlinked-mentions]").should("exist");
        expectNoOverflow();
        cy.openDoc("The brothers at Antioch");
        cy.get("[data-testid=toggle-panel]").click();
        cy.get("[data-testid=linkables]").should("exist");
        expectNoOverflow();
      });

      it("keeps the Source capture box inside the screen", () => {
        // Two type buttons carrying words, the Source's name beside them, and
        // a Locator whose French label names all three of paragraph, page and
        // timestamp — on a phone, in one row that must wrap rather than widen.
        cy.openDoc("Keep Enduring with Joy");
        cy.get("[data-testid=hub-capture]").should("exist");
        expectNoOverflow();
        cy.get("[data-testid=capture-as-note]").click();
        expectNoOverflow();
      });

      it("keeps a condensed Backlink row, badges and all, inside the screen", () => {
        // The longest row the panel can produce: a merged `via` list after
        // "via"/"Liens entrants", beside the kind markers and the mention
        // count, inside a Card that is overflow-hidden.
        cy.openDoc("Antioch");
        cy.get("[data-testid=backlinks] [data-testid=backlink-row]").should(
          "have.length.greaterThan",
          0,
        );
        expectNoOverflow();
        cy.get("[data-testid=backlink-expand]").first().click();
        cy.get("[data-testid=backlink-occurrences]").should("exist");
        expectNoOverflow();
      });

      it("keeps the sync setup dialog inside the screen", () => {
        cy.get("[data-sidebar=trigger]").first().click();
        cy.get("[data-testid=nav-settings]").click();
        cy.get("[data-testid=settings-sync-setup]").click();
        cy.get("[data-testid=sync-pairing]").should("be.visible");
        expectNoOverflow();
      });

      it("keeps the wizard's three cards inside the screen", () => {
        // Three cards, each a title beside a badge with a sentence under it,
        // and the French bodies run half again as long: "Un dossier qu'une
        // autre app garde synchronisé…" against "A folder another app keeps
        // in sync…". The vault must be closed for the wizard to show.
        cy.bridge("close_vault");
        cy.visit("/");
        cy.get("[data-testid=wizard-step-1]", { timeout: 15000 }).should("exist");
        expectNoOverflow();
        cy.get("[data-testid=wizard-next]").click();
        cy.get("[data-testid=wizard-routes]").should("be.visible");
        expectNoOverflow();
        cy.get("[data-testid=route-local]").click();
        cy.get("[data-testid=route-screen-local]").should("be.visible");
        expectNoOverflow();
        // The spec opens the seeded vault once, in before(); put it back.
        cy.bridge("open_vault", { path: Cypress.env("vault") });
      });
    });
  }
});
