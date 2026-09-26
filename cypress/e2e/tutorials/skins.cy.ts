// Walks the Skins Tutorial (docs/tutorials/skins.en.md) step by step, doing
// what each step says, so a change to Appearance or the Skin gallery that
// outdates the Tutorial fails here (PLAN §25.13). Import and Export open the
// system's file dialogs, so step 5 only checks they are where it says. The
// gallery is answered from the repo's own skins/ folder.

type Skin = { id: string };

const PAPER = "01M3EFJMEM168TATWVR2D9BMEW";
const NORD = "01M3EFJMEM1DGWXDHJNM7S0XKH";
const item = (id: string) => cy.get(`[data-testid=skin-gallery-item][data-id=${id}]`);
const worn = () => cy.get("html").invoke("attr", "data-skin");

describe("Tutorial: Skins", () => {
  let mode = "system";
  let scale = 1;
  before(() => {
    cy.bridge<{ appearance_mode: string; text_scale: number }>("get_settings").then((s) => {
      mode = s.appearance_mode ?? "system";
      scale = s.text_scale || 1;
    });
  });
  after(() => cy.bridge("set_device_appearance", { mode, textScale: scale }));

  beforeEach(() => {
    cy.bridge("set_device_appearance", { mode: "light", textScale: 1 });
    cy.bridge("set_appearance", { appearance: { skin: null } });
    cy.bridge<Skin[]>("skins").then((list) => list.forEach((s) => cy.bridge("delete_skin", { id: s.id })));
    cy.stubSkinGallery();
    cy.openApp();
  });

  it("can be followed to the end", () => {
    cy.get("[data-testid=nav-settings]").click();
    cy.openTutorial("skins");

    // 1. Go to Settings; Mode and Text size are this Device's.
    cy.tutorialStep(0);
    cy.tutorialCommand("nav.settings");
    cy.get("[data-testid=settings-appearance]").should("be.visible");
    cy.get("[data-testid=appearance-mode-dark]").click();
    cy.get("html").should("have.class", "dark");
    cy.get("[data-testid=appearance-mode-light]").click();
    cy.get("html").should("not.have.class", "dark");
    cy.get("[data-testid=appearance-scale]").should("be.visible");
    cy.tutorialNext();

    // 2. Pick another Skin from the list: the app changes at once.
    cy.tutorialStep(1);
    cy.get("[data-testid=appearance-skin]").click();
    cy.get("[data-testid='appearance-skin-builtin:sepia']").click();
    worn().should("eq", "builtin:sepia");
    cy.get("[data-testid=appearance-skin]").click();
    cy.get("[data-testid='appearance-skin-builtin:synesis']").click();
    worn().should("eq", "builtin:synesis");
    cy.tutorialNext();

    // 3. The gallery: tap to try on, Light and Dark, closing takes it off.
    cy.tutorialStep(2);
    cy.tutorialCommand("skins.gallery");
    cy.get("[data-testid=skin-gallery]").should("be.visible");
    cy.get("[data-testid=tutorial-panel]").should("be.visible");
    item(NORD).find("[data-testid=skin-gallery-try]").click();
    worn().should("eq", NORD);
    cy.get("[data-testid=skin-gallery-side-dark]").click();
    cy.get("html").should("have.class", "dark");
    cy.get("[data-testid=skin-gallery-close]").click();
    worn().should("eq", "builtin:synesis");
    cy.get("html").should("not.have.class", "dark");
    cy.tutorialNext();

    // 4. Customize makes an editable copy; Undo changes is in its editor.
    cy.tutorialStep(3);
    cy.get("[data-testid=appearance-duplicate]").click();
    cy.get("[data-testid=appearance-delete]").should("be.visible");
    cy.get("[data-testid=appearance-revert]").should("exist");
    cy.get("[data-testid=appearance-delete]").click();
    cy.get("[data-testid=appearance-delete-confirm]").click();
    worn().should("eq", "builtin:synesis");
    cy.tutorialNext();

    // 5. Export and Import sit beside the list.
    cy.tutorialStep(4);
    cy.get("[data-testid=appearance-export]").should("be.visible");
    cy.get("[data-testid=appearance-import]").should("be.visible");
    cy.tutorialNext();

    // 6. Try it once: try Paper on in the gallery and install it.
    cy.tutorialStep(5);
    cy.tutorialCommand("skins.gallery");
    item(PAPER).find("[data-testid=skin-gallery-try]").click();
    worn().should("eq", PAPER);
    item(PAPER).find("[data-testid=skin-gallery-install]").click();
    item(PAPER).should("have.attr", "data-installed", "true");
    cy.bridge<{ skin: string | null }>("appearance").its("skin").should("eq", PAPER);
    cy.tutorialDone();
  });
});

export {};
