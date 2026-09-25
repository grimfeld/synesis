// Settings -> Appearance (PLAN §24): the Device's mode and Text scale, the
// Vault's Skin, and the Skin editor painting the app as it goes.

type Skin = { id: string; name: string; light: { seeds: Record<string, string> }; dark: { seeds: Record<string, string> } };

/** Set a range or colour input the way a user's drag does, so React sees it. */
function setInput(testid: string, value: string | number) {
  cy.get(`[data-testid=${testid}]`).then(($el) => {
    const el = $el[0] as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The editor saves after a pause; `cy.bridge` asks once, so wait the pause out first. */
const skinsAfterSave = () => cy.wait(900).then(() => cy.bridge<Skin[]>("skins"));

/** An inline variable on <html>, re-read until the assertion after it holds. */
const htmlVar = (name: string) => cy.document().its("documentElement.style").invoke("getPropertyValue", name);

function openSettings() {
  cy.get("[data-testid=nav-settings]").click();
  cy.get("[data-testid=settings-appearance]").should("be.visible");
}

describe("Appearance", () => {
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
    cy.openApp();
    openSettings();
  });

  it("switches between light and dark on this Device", () => {
    cy.get("html").should("not.have.class", "dark");
    cy.get("[data-testid=appearance-mode-dark]").click();
    cy.get("html").should("have.class", "dark");
    cy.bridge<{ appearance_mode: string }>("get_settings").its("appearance_mode").should("eq", "dark");
    cy.get("[data-testid=appearance-mode-light]").click();
    cy.get("html").should("not.have.class", "dark");
  });

  it("scales the text on this Device", () => {
    setInput("appearance-scale", 150);
    cy.get("html").should(($h) => expect($h[0].style.fontSize).to.eq("150%"));
    cy.bridge<{ text_scale: number }>("get_settings").its("text_scale").should("eq", 1.5);
  });

  it("wears a built-in Skin and records the choice in the Vault", () => {
    cy.get("[data-testid=appearance-skin]").click();
    cy.get("[data-testid='appearance-skin-builtin:sepia']").click();
    cy.get("html").should("have.attr", "data-skin", "builtin:sepia");
    htmlVar("--background").should("match", /^oklch/);
    cy.bridge<{ skin: string }>("appearance").its("skin").should("eq", "builtin:sepia");
    // A built-in cannot be edited in place.
    cy.get("[data-testid=appearance-editor]").should("not.exist");
    cy.get("[data-testid=appearance-delete]").should("not.exist");
  });

  it("customizing makes an editable copy that paints the app as it changes", () => {
    cy.get("[data-testid=appearance-duplicate]").click();
    cy.get("[data-testid=appearance-editor]").should("be.visible");
    cy.bridge<Skin[]>("skins").should("have.length", 1);
    cy.bridge<{ skin: string }>("appearance").its("skin").should("have.length", 26);

    setInput("appearance-seed-background-input", "#203040");
    htmlVar("--background").should("match", /^oklch\(0\.3/);
    // The ink the app chose stays readable on the new page.
    cy.get("[data-testid=appearance-seed-text-contrast]").should("not.contain", "·");
    // Saved after a pause, into the Vault.
    skinsAfterSave().its("0.light.seeds.background").should("eq", "#203040");

    // Undo goes back to the copy as it was.
    cy.get("[data-testid=appearance-revert]").click();
    htmlVar("--background").should("eq", "");
    skinsAfterSave().its("0.light.seeds").should("deep.equal", {});
  });

  it("edits the dark side in dark while the editor is open, and goes back after", () => {
    cy.get("[data-testid=appearance-duplicate]").click();
    cy.get("[data-testid=appearance-side-dark]").click();
    cy.get("html").should("have.class", "dark");
    setInput("appearance-seed-accent-input", "#ff8800");
    skinsAfterSave().its("0.dark.seeds.accent").should("eq", "#ff8800");
    cy.bridge<Skin[]>("skins").its("0.light.seeds").should("deep.equal", {});
    cy.get("[data-testid=nav-home]").click();
    cy.get("html").should("not.have.class", "dark");
  });

  it("warns about unreadable text the user chose, without fixing it", () => {
    cy.get("[data-testid=appearance-duplicate]").click();
    setInput("appearance-seed-background-input", "#ffffff");
    setInput("appearance-seed-text-input", "#eeeeee");
    cy.get("[data-testid=appearance-seed-text-contrast]").should("contain", "·");
    skinsAfterSave().its("0.light.seeds.text").should("eq", "#eeeeee");
  });

  it("deleting the Skin the Vault wears goes back to the default", () => {
    cy.get("[data-testid=appearance-duplicate]").click();
    cy.get("[data-testid=appearance-delete]").click();
    cy.get("[data-testid=appearance-delete-confirm]").click();
    cy.get("html").should("have.attr", "data-skin", "builtin:synesis");
    cy.bridge<Skin[]>("skins").should("have.length", 0);
    cy.bridge<{ skin: string | null }>("appearance").its("skin").should("eq", null);
  });

  it("a Skin chosen elsewhere is worn after a restart", () => {
    cy.bridge("set_appearance", { appearance: { skin: "builtin:high-contrast" } });
    cy.openApp();
    cy.get("html").should("have.attr", "data-skin", "builtin:high-contrast");
  });
});
