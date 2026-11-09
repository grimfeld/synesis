// The calendar date picker beside a calendar date field (#120, #126): a
// button opens a month calendar (a Popover on a desktop, a bottom Sheet on a
// phone) with month and year dropdowns, Today and Clear. A pick writes
// `YYYY-MM-DD`; text that is not ISO stays as typed until a day is picked.

/**
 * Open the Note from the sidebar's Search button rather than ⌘K, which
 * Cypress cannot press on macOS (#115).
 */
function openNote() {
  cy.get("[data-testid=sidebar-search]").click();
  cy.get("[data-testid=palette] input[cmdk-input]").type(title);
  cy.get("[data-testid=palette] [cmdk-item]").contains(title).click();
  cy.get("[data-testid=palette]").should("not.exist");
}

/** Each test its own Note: the Vault copy is shared by the spec. */
let title = "";
let made = 0;

/** A Note with one `date` (a calendar date), open with the right panel showing it. */
function noteWithDate(date: string) {
  title = `Dated ${String.fromCharCode(65 + made++)}`;
  cy.bridge("create_document", { docType: "note", title, fields: { date } });
  cy.viewport(1280, 800);
  cy.openApp();
  openNote();
  cy.get("[data-testid=right-panel] [data-testid=property-date]").should(
    "have.attr",
    "data-prop-type",
    "calendar",
  );
}

/** The `date` line of the Note's file. */
function dateInFile() {
  return cy
    .docByTitle(title)
    .then((d) =>
      cy
        .bridge<{ text: string }>("get_document", { id: d.id })
        .then(
          (full) =>
            full.text.split("\n").find((l) => l.startsWith("date:")) ?? "",
        ),
    );
}

const field = "[data-testid=property-date] input";
const at = (suffix = "") => `[data-testid=calendar-picker-date${suffix}]`;

/** Today as the picker writes it. */
function todayIso() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

describe("Calendar date picker", () => {
  afterEach(() => cy.bridge("set_language", { lang: "en" }));

  it("replaces the native date input with a text field and the picker", () => {
    noteWithDate("2026-09-08");
    cy.get(field)
      .should("have.attr", "type", "text")
      .and("have.value", "2026-09-08");
    cy.get(at("-open")).click();
    cy.get(at()).should("have.attr", "data-shell", "popover");
    cy.get(`${at()} td[data-day="2026-09-08"]`).should(
      "have.attr",
      "data-selected",
      "true",
    );
  });

  it("reaches 1611 from the year dropdown and writes the day picked as ISO", () => {
    noteWithDate("");
    cy.get(at("-open")).click();
    cy.get(`${at()} select.rdp-years_dropdown`).select("1611");
    cy.get(`${at()} select.rdp-years_dropdown`).should("have.value", "1611");
    cy.get(`${at()} select.rdp-months_dropdown`).select("4");
    cy.get(`${at()} td[data-day="1611-05-02"] button`).click();
    cy.get(at()).should("not.exist");
    cy.get(field).should("have.value", "1611-05-02");
    dateInFile().should("contain", "1611-05-02");
  });

  it("writes today with Today and empties the field with Clear", () => {
    noteWithDate("1611-05-02");
    cy.get(at("-open")).click();
    cy.get(at("-today")).click();
    cy.get(field).should("have.value", todayIso());
    dateInFile().should("contain", todayIso());
    cy.get(at("-open")).click();
    cy.get(at("-clear")).click();
    cy.get(field).should("have.value", "");
    dateInFile().should("not.contain", todayIso());
  });

  it("leaves text that is not ISO as typed when opened and closed", () => {
    noteWithDate("spring 1611");
    cy.get(at("-open")).click();
    cy.get(`${at()} td[data-selected]`).should("not.exist");
    cy.get("body").type("{esc}");
    cy.get(at()).should("not.exist");
    cy.get(field).should("have.value", "spring 1611");
    dateInFile().should("contain", "spring 1611");
  });

  it("starts the week on Sunday in English and Monday in French, named in the app language", () => {
    noteWithDate("2026-09-08");
    cy.get(at("-open")).click();
    cy.get(`${at()} .rdp-weekday`).first().should("have.text", "Sun");
    cy.get(`${at()} select.rdp-months_dropdown option:selected`).should(
      "have.text",
      "Sep",
    );
    cy.bridge("set_language", { lang: "fr" });
    cy.openApp();
    openNote();
    cy.get(at("-open")).click();
    cy.get(`${at()} .rdp-weekday`).first().should("have.text", "lun.");
    cy.get(`${at()} select.rdp-months_dropdown option:selected`).should(
      "have.text",
      "sept.",
    );
  });

  it("names the form a calendar date takes in the app language", () => {
    noteWithDate("");
    cy.get(field).should("have.attr", "placeholder", "YYYY-MM-DD");
    cy.get("[data-testid=sidebar-new]").click();
    cy.get("[data-testid=new-doc-form]").contains("button", "Source").click();
    cy.get("[data-testid=new-doc-date]").should("have.attr", "placeholder", "YYYY-MM-DD");
    cy.bridge("set_language", { lang: "fr" });
    cy.openApp();
    openNote();
    cy.get(field).should("have.attr", "placeholder", "AAAA-MM-JJ");
  });

  for (const kind of ["Source", "Composition"])
    it(`sets a new ${kind}'s date from its dialog`, () => {
      const name = `Calendar ${kind}`;
      cy.viewport(1280, 800);
      cy.openApp();
      cy.get("[data-testid=sidebar-new]").click();
      cy.get("[data-testid=new-doc-form]").contains("button", kind).click();
      cy.get("[data-testid=new-doc-title]").type(name);
      cy.get("[data-testid=new-doc-form] input[type=date]").should("not.exist");
      cy.get("[data-testid=new-doc-date-picker-open]").click();
      cy.get(
        "[data-testid=new-doc-date-picker] select.rdp-years_dropdown",
      ).select("1611");
      cy.get(
        "[data-testid=new-doc-date-picker] select.rdp-months_dropdown",
      ).select("4");
      cy.get(
        '[data-testid=new-doc-date-picker] td[data-day="1611-05-02"] button',
      ).click();
      cy.get("[data-testid=new-doc-date]").should("have.value", "1611-05-02");
      cy.get("[data-testid=submit-doc]").click();
      cy.docByTitle(name).then((d) =>
        cy
          .bridge<{ text: string }>("get_document", { id: d.id })
          .its("text")
          .should("match", /^date: ['"]?1611-05-02/m),
      );
    });
});
