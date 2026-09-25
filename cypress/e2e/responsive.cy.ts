// Responsive layout: every page of the app, at phone width, with documents
// whose text is longer than any the demo vault ships — a long title, an
// unbroken word, a Clipping whose label is a bare URL. Nothing may be clipped
// and no pane meant to scroll up and down may also slide sideways. Each page
// is screenshotted (cypress/screenshots/responsive.cy.ts/) so a run can be
// looked over by eye as well.
import { expectNoOverflow } from "../support/layout";

const LONG_TITLE =
  "How the brothers at Antioch kept preaching through the persecution that followed Stephen's death and what that teaches about endurance";
// No space to break at: a title pasted from a file name, a hashtag run together.
const UNBROKEN = "Antiochendurancepersecutionpreachingfaithfulnessperseverance";
const URL_QUOTE =
  "https://wol.jw.org/en/wol/d/r1/lp-e/2026000000?q=endurance+in+trials+without+losing+joy&p=par12";

const PHONES = [
  [390, 844],
  [320, 640],
] as const;

const shot = (name: string) => cy.screenshot(name, { capture: "viewport", overwrite: true });

/** Open a document by the start of its title, through the palette. */
const open = (query: string) => {
  cy.palette(query);
  cy.get("[data-testid=palette] [cmdk-item]").first().click();
  cy.get("[data-testid=palette]").should("not.exist");
};

const nav = (view: string) => {
  cy.get("[data-sidebar=trigger]").first().click();
  cy.get(`[data-testid=nav-${view}]`).click();
  cy.get("[data-sidebar=sidebar][data-mobile=true]").should("not.exist");
};

// French labels run half again as long as English ones.
const LANGS = ["en", "fr"] as const;

describe("Responsive layout", () => {
  // Every other spec asserts English strings, so never leave the app in French.
  after(() => cy.bridge("set_language", { lang: "en" }));

  before(() => {
    cy.bridge("create_document", { docType: "note", title: LONG_TITLE, fields: {}, body: `${LONG_TITLE}\n` });
    cy.bridge("create_document", {
      docType: "note",
      title: UNBROKEN,
      fields: { tags: [UNBROKEN.toLowerCase()] },
      body: `${UNBROKEN} ${URL_QUOTE}\n`,
    });
    cy.bridge("create_document", {
      docType: "clipping",
      title: "Unbroken clipping",
      fields: { source: "[[Keep Enduring with Joy]]", locator: "par. 12" },
      body: `> ${URL_QUOTE}\n`,
    });
    cy.bridge("create_document", {
      docType: "composition",
      title: `${UNBROKEN} talk`,
      fields: {},
      body: `${LONG_TITLE}\n`,
    });
  });

  for (const { lang, w, h } of LANGS.flatMap((lang) => PHONES.map(([w, h]) => ({ lang, w, h })))) {
    describe(`${lang}, ${w}px`, () => {
      beforeEach(() => {
        cy.bridge("set_language", { lang });
        cy.viewport(w, h);
        cy.openApp();
      });

      it("keeps Home's long titles on the screen", () => {
        cy.get("[data-testid=home-recent]").should("contain", UNBROKEN);
        cy.get("[data-testid=home-progress]").should("contain", UNBROKEN);
        shot(`${lang}/${w}/home`);
        expectNoOverflow();
      });

      it("keeps every view on the screen", () => {
        for (const view of ["timeline", "coverage", "graph", "library", "clippings", "map", "settings"]) {
          nav(view);
          shot(`${lang}/${w}/${view}`);
          expectNoOverflow();
        }
      });

      it("sets the Timeline's years apart on a phone", () => {
        nav("timeline");
        // A 320px phone leaves a 200px plot: room for one or two years, not five.
        cy.get("[data-testid=tl-year]").should("have.length.greaterThan", 0);
        cy.get("[data-testid=tl-year]").then(($t) => {
          const boxes = [...$t].map((el) => el.getBoundingClientRect()).sort((a, b) => a.left - b.left);
          for (let i = 1; i < boxes.length; i++)
            expect(boxes[i].left, `year label ${i} clear of the one before`).to.be.at.least(boxes[i - 1].right);
        });
      });

      it("keeps the sidebar and its long titles on the screen", () => {
        cy.get("[data-sidebar=trigger]").first().click();
        cy.get("[data-sidebar=sidebar][data-mobile=true]").should("be.visible");
        cy.get("[data-testid=group-note]").should("be.visible");
        shot(`${lang}/${w}/sidebar`);
        expectNoOverflow();
      });

      it("keeps a long Note, its editor and side panel on the screen", () => {
        open(UNBROKEN);
        cy.get(".cm-content", { timeout: 10000 }).should("contain", UNBROKEN);
        shot(`${lang}/${w}/note`);
        expectNoOverflow();
        cy.get("[data-testid=toggle-panel]").click();
        cy.get("[data-testid=right-panel]").should("be.visible");
        shot(`${lang}/${w}/note-panel`);
        expectNoOverflow();
      });

      it("keeps a Note with a long title on the screen", () => {
        open("How the brothers at Antioch");
        cy.get(".cm-content", { timeout: 10000 }).should("exist");
        // The title wraps onto as many lines as it needs rather than being cut.
        cy.get("[data-testid=doc-title]").should(($t) => {
          const el = $t[0];
          expect(el.scrollHeight, "title height").to.be.at.most(el.clientHeight + 1);
          expect(el.clientHeight, "title wraps").to.be.greaterThan(60);
        });
        shot(`${lang}/${w}/note-long-title`);
        expectNoOverflow();
      });

      it("keeps a Clipping quoting a URL on the screen", () => {
        // A Clipping is listed by its quote, not its title.
        cy.contains("[data-testid=home-recent] button", "https://wol.jw.org").click();
        cy.get("[data-testid=toggle-panel]").should("exist");
        shot(`${lang}/${w}/clipping`);
        expectNoOverflow();
      });

      it("keeps a Composition and its Board on the screen", () => {
        open("Talk on endurance");
        shot(`${lang}/${w}/composition`);
        expectNoOverflow();
        cy.get("[data-testid=tab-board]").click();
        cy.get("[data-testid=board-canvas]").should("exist");
        shot(`${lang}/${w}/board`);
        expectNoOverflow();
      });

      // One Hub of each kind the demo vault has, and a Tag.
      for (const [name, title] of [
        ["source", "Keep Enduring with Joy"],
        ["place", "Jerusalem"],
        ["character", "Paul"],
        ["concept", "Endurance"],
        ["event", "The Exodus"],
        ["journey", "The Exodus route"],
        ["chapter", "Romans 8"],
      ] as const) {
        it(`keeps a ${name} Hub on the screen`, () => {
          cy.openDoc(title);
          cy.get("[data-testid=hub-header]").should("exist");
          shot(`${lang}/${w}/${name}`);
          expectNoOverflow();
        });
      }

      it("keeps the palette and the New dialog on the screen", () => {
        cy.palette(UNBROKEN.slice(0, 12));
        cy.get("[data-testid=palette] [cmdk-item]").should("contain", UNBROKEN);
        shot(`${lang}/${w}/palette`);
        expectNoOverflow();
        cy.get("body").type("{esc}");
        cy.get("[data-testid=palette]").should("not.exist");
        cy.get("[data-sidebar=trigger]").first().click();
        cy.get("[data-testid=sidebar-new]").click();
        cy.get("[role=dialog]").should("be.visible");
        shot(`${lang}/${w}/new-dialog`);
        expectNoOverflow();
      });
    });
  }
});
