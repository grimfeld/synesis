// The Skin gallery (PLAN §26): community Skins from the repo's skins/ folder,
// tried on over the whole app and installed into the Vault. The gallery's
// two commands are answered from the repo's own files (cy.stubSkinGallery),
// so nothing here reaches GitHub.

type Skin = { id: string; name: string };

const NORD = "01M3EFJMEM1DGWXDHJNM7S0XKH";
const PAPER = "01M3EFJMEM168TATWVR2D9BMEW";

const item = (id: string) => cy.get(`[data-testid=skin-gallery-item][data-id=${id}]`);
const worn = () => cy.get("html").invoke("attr", "data-skin");

function openGallery() {
  cy.get("[data-testid=appearance-gallery]").click();
  cy.get("[data-testid=skin-gallery]").should("be.visible");
  cy.get("[data-testid=skin-gallery-body]").should("have.attr", "data-state", "ready");
}

describe("Skin gallery", () => {
  // Mode and Text scale are this Device's real settings: put them back.
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
    cy.get("[data-testid=nav-settings]").click();
    cy.get("[data-testid=settings-appearance]").should("be.visible");
  });

  it("lists the repo's Skins, with both sides as swatches", () => {
    openGallery();
    cy.get("[data-testid=skin-gallery-item]").should("have.length.at.least", 2);
    item(NORD).should("contain", "Nord").and("contain", "grimfeld");
    item(NORD).find("[data-testid=skin-gallery-swatch-dark]").should("have.css", "background-color", "rgb(46, 52, 64)");
    item(PAPER).find("[data-testid=skin-gallery-swatch-light]").should("have.css", "background-color", "rgb(248, 246, 241)");
    item(PAPER).find("[data-testid=skin-gallery-install]").should("be.visible");
  });

  it("tries a Skin on over the whole app, on either side, and takes it off on closing", () => {
    openGallery();
    item(NORD).find("[data-testid=skin-gallery-try]").click();
    item(NORD).should("have.attr", "data-trying", "true");
    worn().should("eq", NORD);
    cy.get("[data-testid=skin-gallery-side-dark]").click();
    cy.get("html").should("have.class", "dark");
    // Another row replaces the one being tried.
    item(PAPER).find("[data-testid=skin-gallery-try]").click();
    worn().should("eq", PAPER);
    cy.get("[data-testid=skin-gallery-close]").click();
    cy.get("[data-testid=skin-gallery]").should("not.exist");
    worn().should("eq", "builtin:synesis");
    cy.get("html").should("not.have.class", "dark");
    // Nothing was saved.
    cy.bridge<Skin[]>("skins").should("have.length", 0);
    cy.bridge<{ skin: string | null }>("appearance").its("skin").should("eq", null);
  });

  it("installs a Skin into the Vault, keeping its id, and wears it", () => {
    openGallery();
    item(PAPER).find("[data-testid=skin-gallery-install]").click();
    item(PAPER).should("have.attr", "data-installed", "true");
    item(PAPER).find("[data-testid=skin-gallery-wear]").should("be.disabled");
    cy.bridge<Skin[]>("skins").should((list) => expect(list.map((s) => [s.id, s.name])).to.deep.eq([[PAPER, "Paper"]]));
    cy.bridge<{ skin: string | null }>("appearance").its("skin").should("eq", PAPER);
    // Closing keeps it: it is the Vault's Skin now, and an ordinary one.
    cy.get("[data-testid=skin-gallery-close]").click();
    worn().should("eq", PAPER);
    cy.get("[data-testid=appearance-skin]").should("contain", "Paper");
    cy.get("[data-testid=appearance-delete]").should("be.visible");
  });

  it("wears an installed Skin again, and installs it again as Replace or keep both", () => {
    openGallery();
    item(NORD).find("[data-testid=skin-gallery-install]").click();
    item(PAPER).find("[data-testid=skin-gallery-install]").click();
    worn().should("eq", PAPER);
    item(NORD).find("[data-testid=skin-gallery-wear]").click();
    worn().should("eq", NORD);
    item(NORD).find("[data-testid=skin-gallery-reinstall]").click();
    cy.get("[data-testid=skin-import-keep-both]").click();
    cy.bridge<Skin[]>("skins").should((list) => expect(list.map((s) => s.name).sort()).to.deep.eq(["Nord", "Nord 2", "Paper"]));
  });

  it("closes, and takes the trial off, on Escape and on leaving Settings", () => {
    openGallery();
    item(NORD).find("[data-testid=skin-gallery-try]").click();
    worn().should("eq", NORD);
    cy.get("body").type("{esc}");
    cy.get("[data-testid=skin-gallery]").should("not.exist");
    worn().should("eq", "builtin:synesis");

    openGallery();
    item(NORD).find("[data-testid=skin-gallery-try]").click();
    worn().should("eq", NORD);
    cy.get("[data-testid=nav-home]").click();
    cy.get("[data-testid=skin-gallery]").should("not.exist");
    worn().should("eq", "builtin:synesis");
  });

  it("opens from the Command Palette anywhere", () => {
    cy.get("[data-testid=nav-home]").click();
    cy.runCommand("Browse Skin gallery");
    cy.get("[data-testid=settings-appearance]").should("be.visible");
    cy.get("[data-testid=skin-gallery]").should("be.visible");
  });

  it("says when the gallery can't be reached, and retries", () => {
    cy.stubSkinGallery({ fail: true });
    cy.get("[data-testid=appearance-gallery]").click();
    cy.get("[data-testid=skin-gallery-failed]").should("be.visible");
    cy.stubSkinGallery();
    cy.get("[data-testid=skin-gallery-retry]").click();
    cy.get("[data-testid=skin-gallery-body]").should("have.attr", "data-state", "ready");
    item(NORD).should("be.visible");
  });
});

export {};
