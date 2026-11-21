// A Character's Family section (PLAN §32; ADR 0024): Kinship stored once, on
// the child or on one spouse, and read the other way on the Hub. Reading
// changes no file; "Editing Kinship" below writes only by a pick, a clear, a
// remove or Add child (#152), each checked on disk through the bridge.

/** The chips of one Family row, by their titles. */
const kin = (row: string) => cy.get(`[data-testid=hub-family] [data-testid=family-${row}] [data-testid=family-kin]`);

describe("Family section", () => {
  beforeEach(() => cy.openApp());

  it("shows Jacob's father, mother, spouses, children by mother, and siblings", () => {
    cy.openDoc("Jacob", { exact: true });
    cy.get("[data-testid=hub-family]").should("be.visible");
    kin("father").should("have.length", 1).and("contain", "Isaac");
    kin("mother").should("have.length", 1).and("contain", "Rebekah");
    kin("spouses").then(($c) =>
      expect([...$c].map((c) => c.textContent?.trim())).to.deep.equal(["Leah", "Rachel", "Bilhah", "Zilpah"]),
    );
    // Children under the mother each names, in the order of the spouses.
    cy.get("[data-testid=family-children] [data-testid=family-child-group-heading]").then(($h) =>
      expect([...$h].map((h) => h.textContent?.trim())).to.deep.equal([
        "With Leah",
        "With Rachel",
        "With Bilhah",
        "With Zilpah",
      ]),
    );
    cy.contains("[data-testid=family-child-group]", "With Rachel")
      .find("[data-testid=family-kin]")
      .should("contain", "Joseph")
      .and("contain", "Benjamin");
    cy.contains("[data-testid=family-child-group]", "With Leah").should("contain", "Judah (son of Jacob)");
    // Esau shares both parents with him.
    cy.contains("[data-testid=family-sibling-group]", "Through Isaac and Rebekah").should("contain", "Esau");
    // A chip opens that Character's Hub.
    kin("father").click();
    cy.hubTitle("Isaac");
  });

  it("lists Isaac's children although his file names neither, and leaves it unchanged", () => {
    cy.docByTitle("Isaac").then((isaac) =>
      cy.bridge<{ text: string }>("get_document", { id: isaac.id }).then(({ text: before }) => {
        expect(before).not.to.contain("Jacob");
        cy.openDoc("Isaac", { exact: true });
        kin("children").should("contain", "Jacob").and("contain", "Esau");
        cy.get("[data-testid=family-children] [data-testid=family-child-group-heading]").should(
          "contain",
          "With Rebekah",
        );
        // Rebekah names him; Isaac's file names no one.
        kin("spouses").should("have.length", 1).and("contain", "Rebekah");
        // Half-brother through Abraham alone.
        cy.contains("[data-testid=family-sibling-group]", "Through Abraham").should("contain", "Ishmael");
        cy.bridge<{ text: string }>("get_document", { id: isaac.id }).its("text").should("equal", before);
      }),
    );
  });

  it("lists Jacob as Leah's spouse although only Jacob names her", () => {
    cy.openDoc("Leah", { exact: true });
    kin("spouses").should("have.length", 1).and("contain", "Jacob");
    // Her children stand under the father each names.
    cy.get("[data-testid=family-children] [data-testid=family-child-group-heading]").should("contain", "With Jacob");
    // Nothing named: an empty slot, and the empty rows hidden.
    cy.get("[data-testid=family-father] [data-testid=family-empty]").should("exist");
    cy.get("[data-testid=family-mother] [data-testid=family-empty]").should("exist");
    cy.get("[data-testid=family-siblings]").should("not.exist");
    cy.get("[data-testid=family-warning]").should("not.exist");
  });

  it("reports bad Kinship data on the Hub and never rewrites the file", () => {
    // A father that is a Place, and two fathers, written to the test copy.
    cy.bridge("create_document", {
      docType: "character",
      title: "Nahor",
      fields: { father: "[[Jerusalem]]" },
      body: "",
    });
    cy.bridge("create_document", {
      docType: "character",
      title: "Lot",
      fields: { father: ["[[Abraham]]", "[[Nahor]]"] },
      body: "",
    });
    // Each is the other's father: a cycle.
    cy.bridge("create_document", { docType: "character", title: "Cain", fields: { father: "[[Enoch]]" }, body: "" });
    cy.bridge("create_document", { docType: "character", title: "Enoch", fields: { father: "[[Cain]]" }, body: "" });
    cy.openApp();

    cy.openDoc("Nahor", { exact: true });
    cy.get("[data-testid=family-warning][data-kind=not_a_character]")
      .should("contain", "Father")
      .and("contain", "Jerusalem");
    cy.get("[data-testid=family-father] [data-testid=family-empty]").should("exist");

    cy.docByTitle("Lot").then((lot) =>
      cy.bridge<{ text: string }>("get_document", { id: lot.id }).then(({ text: before }) => {
        cy.openDoc("Lot", { exact: true });
        cy.get("[data-testid=family-warning][data-kind=two_values]")
          .should("contain", "Abraham")
          .and("contain", "Nahor");
        // Neither is shown, and the file stays as written.
        cy.get("[data-testid=family-father] [data-testid=family-empty]").should("exist");
        cy.bridge<{ text: string }>("get_document", { id: lot.id }).its("text").should("equal", before);
      }),
    );

    cy.openDoc("Cain", { exact: true });
    cy.get("[data-testid=family-warning][data-kind=cycle]").should("contain", "Cain → Enoch → Cain");
    cy.get("[data-testid=family-father] [data-testid=family-empty]").should("exist");
  });
});

/** A Character's file as it stands on disk in the test copy. */
const characterFile = (title: string) =>
  cy.docByTitle(title).then((d) => cy.bridge<{ text: string }>("get_document", { id: d.id }).its("text"));

/** In the open Character picker, type `name` and pick the row for `title`. */
function pickCharacter(name: string, title = name) {
  cy.get("[data-testid=family-picker-input]").type(name);
  cy.contains("[data-testid=picker-option]", title).click();
}

describe("Editing Kinship", () => {
  beforeEach(() => cy.openApp());

  it("sets a Father with the picker, found by an Alias, and hides the Kinship Property rows", () => {
    cy.openDoc("Paul", { exact: true });
    cy.get("[data-testid=family-father] [data-testid=family-empty]").should("exist");
    cy.get("[data-testid=family-father-choose]").click();
    cy.get("[data-testid=family-picker]").should("be.visible");
    // Abraham's Alias.
    pickCharacter("Abram", "Abraham");
    cy.get("[data-testid=family-picker]").should("not.exist");
    kin("father").should("have.length", 1).and("contain", "Abraham");
    characterFile("Paul").should("match", /^father: "\[\[Abraham\]\]"$/m);
    // Kinship is edited here, never as raw rows: not on Paul's Hub, nor on Jacob's, who has all three.
    cy.get("[data-testid=hub-properties] [data-testid=property-father]").should("not.exist");
    cy.openDoc("Jacob", { exact: true });
    kin("spouses").should("have.length", 4);
    cy.get("[data-testid=hub-properties]").should("exist");
    for (const p of ["father", "mother", "spouses"])
      cy.get(`[data-testid=hub-properties] [data-testid=property-${p}]`).should("not.exist");
  });

  it("creates a Character from the picker and sets the link", () => {
    cy.openDoc("Paul", { exact: true });
    cy.get("[data-testid=family-mother-choose]").click();
    cy.get("[data-testid=family-picker-input]").type("Eunice");
    cy.get("[data-testid=picker-create]").should("contain", "Create Character “Eunice”").click();
    kin("mother").should("contain", "Eunice");
    characterFile("Paul").should("match", /^mother: "\[\[Eunice\]\]"$/m);
    // Made the way any new Character is: no Kinship fields of its own.
    characterFile("Eunice").should("match", /^type: character$/m).and("not.match", /^(father|mother|spouses):/m);
  });

  it("clears a Father and removes a Spouse, from that Character's file only", () => {
    characterFile("Isaac").then((isaacBefore) => {
      cy.openDoc("Jacob", { exact: true });
      cy.get("[data-testid=family-father-clear]").click();
      cy.get("[data-testid=family-father] [data-testid=family-empty]").should("exist");
      characterFile("Jacob").should("not.match", /^father:/m).and("match", /^mother: "\[\[Rebekah\]\]"$/m);
      // Isaac's file never named Jacob, and is left as it was.
      characterFile("Isaac").should("equal", isaacBefore);
    });
    // Leah is named in Jacob's own spouses: removable here.
    cy.contains("[data-testid=family-spouses] [data-testid=family-kin]", "Leah")
      .parent()
      .find("[data-testid=family-remove]")
      .click();
    kin("spouses").should("have.length", 3).and("not.contain", "Leah");
    characterFile("Jacob").should("match", /^spouses: \["\[\[Rachel\]\]", "\[\[Bilhah\]\]", "\[\[Zilpah\]\]"\]$/m);
    // Isaac names no one, Rebekah names him: no remove on Isaac's Hub for her.
    cy.openDoc("Isaac", { exact: true });
    kin("spouses").should("contain", "Rebekah");
    cy.get("[data-testid=family-spouses] [data-testid=family-remove]").should("not.exist");
  });

  it("adds a spouse at the end of the list", () => {
    cy.openDoc("Paul", { exact: true });
    cy.get("[data-testid=family-spouses]").should("not.exist");
    cy.get("[data-testid=family-add-spouse]").click();
    pickCharacter("Hagar");
    kin("spouses").should("have.length", 1).and("contain", "Hagar");
    characterFile("Paul").should("match", /^spouses: \["\[\[Hagar\]\]"\]$/m);
  });

  it("shows empty slots and the Add buttons on a Character with no kin", () => {
    cy.openDoc("Paul", { exact: true });
    cy.get("[data-testid=family-father] [data-testid=family-father-choose]").should("be.visible");
    cy.get("[data-testid=family-mother] [data-testid=family-mother-choose]").should("be.visible");
    cy.get("[data-testid=family-spouses]").should("not.exist");
    cy.get("[data-testid=family-children]").should("not.exist");
    cy.get("[data-testid=family-add-spouse]").should("be.visible");
    cy.get("[data-testid=family-add-child]").should("be.visible");
  });

  it("Add child asks father or mother the first time, then not again", () => {
    characterFile("Paul").then((paulBefore) => {
      cy.openDoc("Paul", { exact: true });
      cy.get("[data-testid=family-add-child]").click();
      pickCharacter("Timothy");
      cy.get("[data-testid=family-role-question]").should("contain", "Paul").and("contain", "Timothy");
      cy.get("[data-testid=family-role-father]").click();
      cy.get("[data-testid=family-picker]").should("not.exist");
      kin("children").should("contain", "Timothy");
      characterFile("Timothy").should("match", /^father: "\[\[Paul\]\]"$/m);
      // Nothing is written on the parent.
      characterFile("Paul").should("equal", paulBefore);
    });
    // Paul is now someone's father: no question.
    cy.get("[data-testid=family-add-child]").click();
    pickCharacter("Peter");
    cy.get("[data-testid=family-picker]").should("not.exist");
    cy.get("[data-testid=family-role-question]").should("not.exist");
    kin("children").should("contain", "Peter");
    characterFile("Peter").should("match", /^father: "\[\[Paul\]\]"$/m);
  });

  it("Add child does not ask a Character already the father of another child", () => {
    cy.openDoc("Isaac", { exact: true });
    cy.get("[data-testid=family-add-child]").click();
    cy.get("[data-testid=family-picker-input]").type("Edom");
    cy.get("[data-testid=picker-create]").click();
    cy.get("[data-testid=family-role-question]").should("not.exist");
    kin("children").should("contain", "Edom");
    characterFile("Edom").should("match", /^father: "\[\[Isaac\]\]"$/m);
  });

  it("refuses Add child for a child who already has another father, naming him", () => {
    characterFile("Jacob").then((jacobBefore) => {
      cy.openDoc("Abraham", { exact: true });
      cy.get("[data-testid=family-add-child]").click();
      pickCharacter("Jacob");
      cy.get("[data-testid=family-refused]").should("contain", "Isaac");
      cy.get("[data-testid=family-picker]").should("be.visible");
      characterFile("Jacob").should("equal", jacobBefore);
    });
  });

  it("offers no Create for an existing Character the picker leaves out", () => {
    cy.openDoc("Isaac", { exact: true });
    cy.get("[data-testid=family-add-child]").click();
    // Esau is already Isaac's child: not offered, and not to be made twice.
    cy.get("[data-testid=family-picker-input]").type("Esau");
    cy.get("[data-testid=picker-excluded]").should("be.visible").and("contain", "Esau");
    cy.get("[data-testid=picker-option]").should("not.exist");
    cy.get("[data-testid=picker-create]").should("not.exist");
    cy.get("[data-testid=family-picker-input]").type("{enter}");
    cy.query<{ title: string }[]>({ kind: "list", docType: null }).then((docs) =>
      expect(docs.filter((d) => d.title.startsWith("Esau"))).to.have.length(1),
    );
  });

  it("picks the second match with ArrowDown and Enter", () => {
    cy.openDoc("Paul", { exact: true });
    cy.get("[data-testid=family-add-spouse]").click();
    cy.get("[data-testid=family-picker-input]").type("Jo");
    cy.get("[data-testid=picker-option]").should("have.length.greaterThan", 1);
    cy.get("[data-testid=picker-option]")
      .eq(1)
      .invoke("attr", "data-id")
      .then((second) => {
        cy.get("[data-testid=family-picker-input]").type("{downarrow}{downarrow}");
        cy.get("[data-testid=picker-option]").eq(1).should("have.attr", "aria-selected", "true");
        cy.get("[data-testid=family-picker-input]")
          .invoke("attr", "aria-activedescendant")
          .then((active) => cy.get("[data-testid=picker-option]").eq(1).should("have.attr", "id", active));
        cy.get("[data-testid=family-picker-input]").type("{enter}");
        cy.get("[data-testid=family-picker]").should("not.exist");
        kin("spouses").should("have.length", 1).and("have.attr", "data-id", second);
      });
  });

  it("Enter with several matches and no exact title creates nothing", () => {
    characterFile("Paul").then((paulBefore) => {
      cy.openDoc("Paul", { exact: true });
      cy.get("[data-testid=family-add-spouse]").click();
      cy.get("[data-testid=family-picker-input]").type("Jo");
      cy.get("[data-testid=picker-option]").should("have.length.greaterThan", 1);
      cy.get("[data-testid=picker-create]").should("exist");
      cy.get("[data-testid=family-picker-input]").type("{enter}");
      cy.get("[data-testid=family-picker]").should("be.visible");
      cy.query<{ title: string }[]>({ kind: "list", docType: null }).then((docs) =>
        expect(docs.map((d) => d.title)).not.to.include("Jo"),
      );
      characterFile("Paul").should("equal", paulBefore);
    });
  });
});
