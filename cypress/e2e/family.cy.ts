// A Character's Family section (PLAN §32; ADR 0024): Kinship stored once, on
// the child or on one spouse, and read the other way on the Hub. Read-only:
// nothing here may change a file.

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
