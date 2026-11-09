// The Date picker beside a Date field (#120, #122): a button opens it (a
// Popover on a desktop, a bottom Sheet on a phone); a pick writes the Date
// into the field through the engine, keeping the text's Reckoning and note,
// and the preview reads it. The field stays the Date and stays editable.

/**
 * Open the Note from the sidebar's Search button rather than ⌘K, which
 * Cypress cannot press on macOS (#115).
 */
function openPicked(phone: boolean) {
  if (phone) cy.get("[data-sidebar=trigger]").first().click();
  cy.get("[data-testid=sidebar-search]").click();
  cy.get("[data-testid=palette] input[cmdk-input]").type(title);
  cy.get("[data-testid=palette] [cmdk-item]").contains(title).click();
  cy.get("[data-testid=palette]").should("not.exist");
}

/** Each test its own Note: the Vault copy is shared by the spec. */
let title = "";
let made = 0;

/** A Note with one `born` Date, open with the right panel showing it. */
function noteWithBorn(born: string, viewport: "desktop" | "phone" = "desktop") {
  title = `Picked ${String.fromCharCode(65 + made++)}`;
  cy.bridge("create_document", { docType: "note", title, fields: { born } });
  if (viewport === "phone") cy.viewport(390, 844);
  else cy.viewport(1280, 800);
  cy.openApp();
  openPicked(viewport === "phone");
  if (viewport === "phone") cy.get("[data-testid=toggle-panel]").click();
  cy.get("[data-testid=right-panel] [data-testid=property-born]").should(
    "have.attr",
    "data-prop-type",
    "date",
  );
}

/** The `born` line of the Note's file. */
function bornInFile() {
  return cy.docByTitle(title).then((d) =>
    cy
      .bridge<{ text: string }>("get_document", { id: d.id })
      .then((full) => full.text.split("\n").find((l) => l.startsWith("born:")) ?? ""),
  );
}

const field = "[data-testid=property-born] input";
const picker = "date-picker-born";
const at = (suffix = "") => `[data-testid=${picker}${suffix}]`;

describe("Date picker", () => {
  afterEach(() => cy.bridge("set_language", { lang: "en" }));

  it("writes an approximate year BCE on an empty field, and the preview reads it", () => {
    noteWithBorn("");
    cy.get(at("-open")).click();
    cy.get(at()).should("have.attr", "data-shell", "popover");
    cy.get(at("-approx")).click();
    cy.get(at("-year")).type("1513");
    cy.get(at("-era-bce")).click();
    cy.get(field).should("have.value", "c. 1513 BCE");
    cy.get("[data-testid=date-preview-born]").should("have.attr", "data-ok", "true");
    cy.get("body").type("{esc}");
    cy.get(at()).should("not.exist");
    bornInFile().should("contain", "c. 1513 BCE");
  });

  it("writes it in French in the French form", () => {
    cy.bridge("set_language", { lang: "fr" });
    noteWithBorn("");
    cy.get(at("-open")).click();
    cy.get(at("-approx")).click();
    cy.get(at("-year")).type("1513");
    cy.get(at("-era-bce")).click();
    cy.get(field).should("have.value", "vers 1513 av. n. è.");
    cy.get("[data-testid=date-preview-born]").should("have.attr", "data-ok", "true");
  });

  it("keeps BC and the note when the year changes", () => {
    noteWithBorn("1000 BC (1 Sam 16)");
    cy.get(at("-open")).click();
    // The picker opens on the Date the field holds, in its Reckoning.
    cy.get(at("-year")).should("have.value", "1000");
    cy.get(at("-era-bce")).should("have.attr", "data-state", "on").and("contain", "BC");
    cy.get(at("-year")).clear().type("1010");
    cy.get(field).should("have.value", "1010 BC (1 Sam 16)");
    bornInFile().should("contain", "1010 BC (1 Sam 16)");
  });

  it("follows what is typed in the field", () => {
    noteWithBorn("");
    cy.get(field).type("c. 33 CE").blur();
    cy.get(at("-open")).click();
    cy.get(at("-year")).should("have.value", "33");
    cy.get(at("-era-ce")).should("have.attr", "data-state", "on");
    cy.get(at("-approx")).should("have.attr", "data-state", "checked");
  });

  it("leaves the text byte for byte as it was when opened and closed", () => {
    noteWithBorn("ca. 1000 B.C. (1 Sam 16)");
    bornInFile().then((before) => {
      cy.get(at("-open")).click();
      cy.get(at("-year")).should("have.value", "1000");
      cy.get("body").type("{esc}");
      cy.get(at()).should("not.exist");
      cy.get(field).should("have.value", "ca. 1000 B.C. (1 Sam 16)");
      // Longer than the field's save would take, so a write would be on disk.
      cy.wait(800);
      bornInFile().should("equal", before);
    });
  });

  it("opens in a bottom Sheet at phone width", () => {
    noteWithBorn("", "phone");
    cy.get(at("-open")).click();
    cy.get(at()).should("have.attr", "data-shell", "sheet").and("be.visible");
    cy.get(at("-year")).type("70");
    cy.get(at("-era-ce")).click();
    cy.get("body").type("{esc}");
    cy.get(field).should("have.value", "70 CE");
    bornInFile().should("contain", "70 CE");
  });
});
