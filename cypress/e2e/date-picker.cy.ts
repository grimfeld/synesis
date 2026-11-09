// The Date picker beside a Date field (#120, #122, #123): a button opens it (a
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
    // The preview words the Date as the picker writes it.
    cy.get("[data-testid=date-preview-born]")
      .should("have.attr", "data-ok", "true")
      .and("contain", "vers 1513 av. n. è. · année");
  });

  it("keeps BC and the note when the year changes", () => {
    noteWithBorn("1000 BC (1 Sam 16)");
    cy.get(at("-open")).click();
    // The picker opens on the Date the field holds, in its Reckoning.
    cy.get(at("-year")).should("have.value", "1000");
    cy.get(at("-era-bce")).should("have.attr", "data-state", "on").and("contain", "BC");
    cy.get(at("-year")).clear().type("1010{enter}");
    cy.get(field).should("have.value", "1010 BC (1 Sam 16)");
    bornInFile().should("contain", "1010 BC (1 Sam 16)");
  });

  it("flags year 0 with a hint and leaves the text as it was", () => {
    noteWithBorn("1000 BC (1 Sam 16)");
    cy.get(at("-open")).click();
    cy.get(at("-year")).should("have.value", "1000");
    cy.get(at("-year-hint")).should("not.exist");
    cy.get(at("-year")).clear().type("0{enter}");
    cy.get(at("-year")).should("have.attr", "aria-invalid", "true");
    cy.get(at("-year-hint"))
      .should("be.visible")
      .invoke("attr", "id")
      .then((hint) => cy.get(at("-year")).should("have.attr", "aria-describedby", hint));
    cy.get("body").type("{esc}");
    cy.get(at()).should("not.exist");
    cy.get(field).should("have.value", "1000 BC (1 Sam 16)");
    // Longer than the field's save would take, so a write would be on disk.
    cy.wait(800);
    bornInFile().should("contain", "1000 BC (1 Sam 16)");
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

  /** Choose `value` in the picker's `segment` (month or day) Select. */
  function choose(segment: "month" | "day", value: string) {
    cy.get(at(`-${segment}`)).click();
    cy.get(at(`-${segment}-${value}`)).click();
  }

  it("writes a day, a civil month and a year, and the preview reads the day", () => {
    noteWithBorn("");
    cy.get(at("-open")).click();
    cy.get(at("-year")).type("33");
    cy.get(at("-era-ce")).click();
    choose("month", "3");
    choose("day", "14");
    cy.get(field).should("have.value", "14 March 33 CE");
    cy.get("[data-testid=date-preview-born]")
      .should("have.attr", "data-ok", "true")
      .and("contain", "day");
    bornInFile().should("contain", "14 March 33 CE");
  });

  it("writes the day and month in French in the French form", () => {
    cy.bridge("set_language", { lang: "fr" });
    noteWithBorn("");
    cy.get(at("-open")).click();
    cy.get(at("-year")).type("33");
    cy.get(at("-era-ce")).click();
    choose("month", "3");
    choose("day", "14");
    cy.get(field).should("have.value", "14 mars 33 de n. è.");
    cy.get("[data-testid=date-preview-born]")
      .should("have.attr", "data-ok", "true")
      .and("contain", "jour");
  });

  it("offers a day only once a month is chosen, and only the days it has", () => {
    noteWithBorn("33 CE");
    cy.get(at("-open")).click();
    cy.get(at("-day")).should("be.disabled");
    choose("month", "2");
    cy.get(at("-day")).should("not.be.disabled").click();
    cy.get(at("-day-1")).should("exist");
    cy.get(at("-day-29")).should("exist");
    cy.get(at("-day-30")).should("not.exist");
    cy.get(at("-day-29")).click();
    choose("month", "4");
    cy.get(at("-day")).click();
    cy.get(at("-day-30")).should("exist");
    cy.get(at("-day-31")).should("not.exist");
  });

  it("clears the day with the month, and the Date becomes a year", () => {
    noteWithBorn("14 March 33 CE");
    cy.get(at("-open")).click();
    // The picker opens on the month and day the field holds.
    cy.get(at("-month")).should("contain", "March");
    cy.get(at("-day")).should("contain", "14");
    choose("month", "none");
    cy.get(at("-day")).should("be.disabled").and("not.contain", "14");
    cy.get(field).should("have.value", "33 CE");
    bornInFile().should("contain", "33 CE").and("not.contain", "March");
  });

  it("writes a day, a Hebrew month and a year", () => {
    noteWithBorn("");
    cy.get(at("-open")).click();
    cy.get(at("-year")).type("33");
    cy.get(at("-era-ce")).click();
    cy.get(at("-calendar-hebrew")).click();
    choose("month", "nisan");
    choose("day", "14");
    cy.get(field).should("have.value", "14 Nisan 33 CE");
    cy.get("[data-testid=date-preview-born]").should("have.attr", "data-ok", "true");
    bornInFile().should("contain", "14 Nisan 33 CE");
  });

  it("writes the Hebrew month in French in the French form", () => {
    cy.bridge("set_language", { lang: "fr" });
    noteWithBorn("");
    cy.get(at("-open")).click();
    cy.get(at("-year")).type("33");
    cy.get(at("-era-ce")).click();
    cy.get(at("-calendar-hebrew")).click();
    choose("month", "nisan");
    choose("day", "14");
    cy.get(field).should("have.value", "14 Nissan 33 de n. è.");
    cy.get("[data-testid=date-preview-born]").should(
      "contain",
      "14 Nissan 33 de n. è. · jour",
    );
  });

  it("shows the picker's French forms in the preview, whatever spelling was typed", () => {
    cy.bridge("set_language", { lang: "fr" });
    noteWithBorn("v. 14 tammouz 33 de n. è.");
    cy.get("[data-testid=date-preview-born]").should(
      "contain",
      "vers 14 Tamouz 33 de n. è. · jour",
    );
    // The text stays as typed.
    cy.get(field).should("have.value", "v. 14 tammouz 33 de n. è.");
  });

  it("opens on the Hebrew calendar at Adar II, with days 1 to 30", () => {
    noteWithBorn("14 Adar II 33 CE");
    cy.get(at("-open")).click();
    cy.get(at("-calendar-hebrew")).should("have.attr", "data-state", "on");
    cy.get(at("-month")).should("contain", "Adar II");
    cy.get(at("-day")).should("contain", "14").click();
    cy.get(at("-day-30")).should("exist");
    cy.get(at("-day-31")).should("not.exist");
    cy.get(at("-day-30")).click();
    cy.get(field).should("have.value", "30 Adar II 33 CE");
  });

  it("regenerates a Hebrew Date in the picker's form when the year changes", () => {
    noteWithBorn("ca. 3 Nissan 33 AD (Jn 19)");
    cy.get(at("-open")).click();
    cy.get(at("-month")).should("contain", "Nisan");
    cy.get(at("-year")).clear().type("34{enter}");
    cy.get(field).should("have.value", "c. 3 Nisan 34 AD (Jn 19)");
    bornInFile().should("contain", "c. 3 Nisan 34 AD (Jn 19)");
  });

  it("writes the year when it is committed, not on every digit", () => {
    noteWithBorn("1000 BC (1 Sam 16)");
    cy.get(at("-open")).click();
    cy.get(at("-year")).should("have.value", "1000").clear().type("1015");
    // Typing writes nothing: no "1 BC", "10 BC", "101 BC" on the way.
    cy.wait(800);
    cy.get(field).should("have.value", "1000 BC (1 Sam 16)");
    bornInFile().should("contain", "1000 BC (1 Sam 16)");
    // Enter commits it.
    cy.get(at("-year")).type("{enter}");
    cy.get(field).should("have.value", "1015 BC (1 Sam 16)");
    bornInFile().should("contain", "1015 BC (1 Sam 16)");
    // So does leaving the segment…
    cy.get(at("-year")).clear().type("1016").blur();
    cy.get(field).should("have.value", "1016 BC (1 Sam 16)");
    bornInFile().should("contain", "1016 BC (1 Sam 16)");
    // …and closing the picker.
    cy.get(at("-year")).clear().type("1017");
    cy.get("body").type("{esc}");
    cy.get(at()).should("not.exist");
    cy.get(field).should("have.value", "1017 BC (1 Sam 16)");
    bornInFile().should("contain", "1017 BC (1 Sam 16)");
  });

  it("starts afresh when the field is cleared", () => {
    noteWithBorn("14 March 33 CE");
    cy.get(field).clear().blur();
    bornInFile().should("not.contain", "March");
    cy.get(at("-open")).click();
    cy.get(at("-year")).should("have.value", "");
    cy.get(at("-month")).should("not.contain", "March");
    cy.get(at("-day")).should("be.disabled");
    // Touching a segment does not write the old Date back.
    cy.get(at("-approx")).click();
    cy.get("body").type("{esc}");
    cy.wait(800);
    cy.get(field).should("have.value", "");
    bornInFile().should("not.contain", "33");
  });

  it("labels the month and era with the words a pick writes", () => {
    cy.bridge("set_language", { lang: "fr" });
    noteWithBorn("70 ap. J.-C.");
    cy.get(at("-open")).click();
    cy.get(at("-era-bce")).should("have.text", "av. J.-C.");
    cy.get(at("-era-ce")).should("have.text", "ap. J.-C.");
    cy.get(at("-month")).click();
    cy.get(at("-month-8")).should("have.text", "août").click();
    cy.get(field).should("have.value", "août 70 ap. J.-C.");
  });

  it("gives every control a finger's size in the phone Sheet", () => {
    noteWithBorn("14 March 33 CE", "phone");
    cy.get(at("-open")).click();
    cy.get(at()).should("have.attr", "data-shell", "sheet");
    for (const suffix of [
      "-year",
      "-month",
      "-day",
      "-era-bce",
      "-era-ce",
      "-calendar-civil",
      "-calendar-hebrew",
    ]) {
      cy.get(at(suffix)).then(($el) => {
        expect($el[0].getBoundingClientRect().height, suffix).to.be.at.least(40);
      });
    }
    cy.get(at("-approx"))
      .parent()
      .then(($row) => {
        expect($row[0].getBoundingClientRect().height, "approx row").to.be.at.least(40);
      });
    cy.get(at("-month")).click();
    cy.get(at("-month-4")).then(($el) => {
      expect($el[0].getBoundingClientRect().height, "month item").to.be.at.least(40);
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

// The same picker wherever a Date is entered (#125): the Hub's Dates section
// and the New dialog's Span fields. One picker per field; no range mode.
describe("Date picker beyond the right panel", () => {
  afterEach(() => cy.bridge("set_language", { lang: "en" }));

  /** Open a page, or run a Command (">…"), from the sidebar's Search button. */
  function search(query: string, pick: string) {
    cy.get("[data-testid=sidebar-search]").click();
    cy.get("[data-testid=palette] input[cmdk-input]").type(query);
    cy.get("[data-testid=palette] [cmdk-item]").contains(pick).click();
    cy.get("[data-testid=palette]").should("not.exist");
  }

  it("sets a Date in a Hub's Dates section the way the right panel does", () => {
    const name = `Hub Picked ${made++}`;
    cy.bridge("create_document", {
      docType: "character",
      title: name,
      fields: { born: "1000 BC (1 Sam 16)" },
    });
    cy.viewport(1280, 800);
    cy.openApp();
    search(name, name);
    const hub = (suffix = "") => `[data-testid=hub-date-picker-born${suffix}]`;
    cy.get(`[data-testid=hub-dates] ${hub("-open")}`).click();
    cy.get(hub()).should("have.attr", "data-shell", "popover");
    cy.get(hub("-year")).should("have.value", "1000");
    cy.get(hub("-year")).clear().type("1010{enter}");
    cy.get("[data-testid=date-input-born]").should("have.value", "1010 BC (1 Sam 16)");
    cy.get("body").type("{esc}");
    cy.get(hub()).should("not.exist");
    cy.docByTitle(name).then((d) =>
      cy
        .bridge<{ text: string }>("get_document", { id: d.id })
        .its("text")
        .should("contain", "born: 1010 BC (1 Sam 16)"),
    );
  });

  it("gives an Event's start and end each a picker, and the Event lands on the Timeline", () => {
    const name = `Picked Event ${made++}`;
    cy.viewport(1280, 800);
    cy.openApp();
    search(">New Event", "New Event");
    cy.get("[data-testid=new-doc-form] input").first().type(name);
    const start = (suffix = "") => `[data-testid=new-date-picker-start${suffix}]`;
    const end = (suffix = "") => `[data-testid=new-date-picker-end${suffix}]`;
    cy.get(start("-open")).click();
    cy.get(start("-approx")).click();
    cy.get(start("-year")).type("1513");
    cy.get(start("-era-bce")).click();
    cy.get("[data-testid=new-start]").should("have.value", "c. 1513 BCE");
    cy.get("body").type("{esc}");
    cy.get(start()).should("not.exist");
    // Closing the picker leaves the dialog open.
    cy.get("[data-testid=new-doc-form]").should("be.visible");
    cy.get(end("-open")).click();
    cy.get(end("-year")).type("1473");
    cy.get(end("-era-bce")).click();
    cy.get("[data-testid=new-end]").should("have.value", "1473 BCE");
    cy.get("body").type("{esc}");
    cy.get(end()).should("not.exist");
    cy.get("[data-testid=new-doc-form]").contains("button", "Create").click();
    cy.get("[data-testid=hub-header]").should("contain", "Event");
    cy.get("[data-testid=date-input-start]").should("have.value", "c. 1513 BCE");
    cy.docByTitle(name).then((d) => {
      cy.query<{ doc: { id: string }; name: string }[]>({ kind: "timeline" }).then(
        (rows) => {
          const mine = rows.filter((r) => r.doc.id === d.id).map((r) => r.name);
          expect(mine).to.have.members(["start", "end"]);
        },
      );
    });
  });
});
