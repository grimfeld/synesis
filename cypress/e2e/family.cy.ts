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

// Relations (#153; CONTEXT.md, Relation): a link Property between Characters
// that is not Kinship, shown on both Hubs in the Property's own word. Read
// from the files as written; nothing is written.
const relations = () => cy.get("[data-testid=hub-relations] [data-testid=hub-relation]");

describe("Relations section", () => {
  beforeEach(() => cy.openApp());

  it("shows Elisha's mentor on both Hubs and leaves both files unchanged", () => {
    characterFile("Elisha").then((elishaBefore) =>
      characterFile("Elijah").then((elijahBefore) => {
        expect(elijahBefore).not.to.contain("Elisha");
        cy.openDoc("Elisha", { exact: true });
        relations()
          .should("have.length", 1)
          .first()
          .should("have.attr", "data-direction", "out")
          .and("contain", "mentor:")
          .and("contain", "Elijah");
        // Named only on Elisha's side, read the other way on Elijah's.
        relations().first().find("button").click();
        cy.hubTitle("Elijah");
        relations()
          .should("have.length", 1)
          .first()
          .should("have.attr", "data-direction", "in")
          .and("contain", "mentor of:")
          .and("contain", "Elisha");
        characterFile("Elisha").should("equal", elishaBefore);
        characterFile("Elijah").should("equal", elijahBefore);
      }),
    );
  });

  it("leaves out Kinship and a link to a Place", () => {
    // A servant whose father and home are links, beside one Relation.
    cy.bridge("create_document", {
      docType: "character",
      title: "Gehazi",
      fields: {
        father: "[[Elijah]]",
        home: "[[Jerusalem]]",
        master: "[[Elisha]]",
      },
      body: "",
    });
    cy.openApp();
    cy.openDoc("Gehazi", { exact: true });
    relations().should("have.length", 1).and("contain", "master:").and("contain", "Elisha");
    cy.get("[data-testid=hub-relation][data-property=father]").should("not.exist");
    cy.get("[data-testid=hub-relation][data-property=home]").should("not.exist");
    // The father is Kinship: shown in the Family section instead.
    kin("father").should("contain", "Elijah");
    cy.openDoc("Elisha", { exact: true });
    cy.get("[data-testid=hub-relation][data-direction=in]").should("contain", "master of:").and("contain", "Gehazi");
    cy.openDoc("Elijah", { exact: true });
    cy.get("[data-testid=hub-relation][data-property=father]").should("not.exist");
    relations().should("have.length", 1).and("contain", "mentor of:");
    // A Place's Hub has no Relations, and a Character without any shows none.
    cy.openDoc("Jerusalem", { exact: true });
    cy.get("[data-testid=hub-relations]").should("not.exist");
    cy.openDoc("Jacob", { exact: true });
    cy.get("[data-testid=hub-family]").should("be.visible");
    cy.get("[data-testid=hub-relations]").should("not.exist");
  });
});

// The Family tree view (#154): every family at once, from the same Kinship.
describe("Family tree", () => {
  beforeEach(() => cy.openApp());

  const person = (id: string) => cy.get(`[data-testid=family-tree-person][data-id="${id}"]`);
  const ids = (...titles: string[]) =>
    cy
      .query<{ id: string; title: string }[]>({ kind: "list", docType: "character" })
      .then((docs) => titles.map((t) => docs.find((d) => d.title === t)!.id));

  it("Go to Family tree draws every Character with kin once, in rows by generation", () => {
    cy.runCommand("Go to Family tree");
    cy.get("[data-testid=family-tree]").should("be.visible").and("have.attr", "data-families", "1");
    // No Character is drawn twice.
    cy.get("[data-testid=family-tree-person]").then(($p) => {
      const all = [...$p].map((p) => p.getAttribute("data-id"));
      expect(new Set(all).size).to.equal(all.length);
    });
    ids("Terah", "Abraham", "Sarah", "Jacob", "Rachel", "Joseph", "Paul").then(
      ([terah, abraham, sarah, jacob, rachel, joseph, paul]) => {
        // Abraham and Sarah, half-siblings through Terah and spouses: once each,
        // a line from Terah to both, side by side in one row.
        person(abraham).should("have.length", 1).and("have.attr", "data-generation", "1");
        person(sarah).should("have.length", 1).and("have.attr", "data-generation", "1");
        person(terah).should("have.attr", "data-generation", "0");
        cy.get(`[data-testid=family-tree-line][data-child="${abraham}"]`).should("have.attr", "data-parents", terah);
        cy.get(`[data-testid=family-tree-line][data-child="${sarah}"]`).should("have.attr", "data-parents", terah);
        cy.get("[data-testid=family-tree-bar]")
          .filter((_, e) => [e.dataset.a, e.dataset.b].sort().join() === [abraham, sarah].sort().join())
          .should("have.length", 1);
        // Joseph hangs from the bar of Jacob and Rachel.
        cy.get(`[data-testid=family-tree-line][data-child="${joseph}"]`).should(
          "have.attr",
          "data-parents",
          `${jacob} ${rachel}`,
        );
        // A Character with no kin is not drawn.
        person(paul).should("not.exist");
      },
    );
    cy.get("[data-testid=family-tree-counts]").should("contain", "Characters").and("contain", "1 family");
  });

  it("opens from the sidebar, and a person opens their Hub", () => {
    cy.get("[data-testid=nav-family-tree]").click();
    cy.get("[data-testid=family-tree]").should("be.visible");
    ids("Jacob").then(([jacob]) => person(jacob).click());
    cy.hubTitle("Jacob");
  });

  it("draws an unrelated family as its own tree, side by side", () => {
    cy.bridge("create_document", { docType: "character", title: "Elkanah", fields: { spouses: ["[[Hannah]]"] }, body: "" });
    cy.bridge("create_document", { docType: "character", title: "Hannah", fields: {}, body: "" });
    cy.bridge("create_document", {
      docType: "character",
      title: "Samuel",
      fields: { father: "[[Elkanah]]", mother: "[[Hannah]]" },
      body: "",
    });
    cy.openApp();
    cy.runCommand("Go to Family tree");
    cy.get("[data-testid=family-tree]").should("have.attr", "data-families", "2");
    cy.get("[data-testid=family-tree-person][data-family=0]").then(($a) =>
      cy.get("[data-testid=family-tree-person][data-family=1]").then(($b) => {
        const right = Math.max(...[...$a].map((e) => e.getBoundingClientRect().right));
        const left = Math.min(...[...$b].map((e) => e.getBoundingClientRect().left));
        expect(left).to.be.greaterThan(right);
        expect([...$b].map((e) => e.getAttribute("data-generation")).sort()).to.deep.equal(["0", "0", "1"]);
      }),
    );
  });

  it("pans and zooms, and hides the names far out", () => {
    cy.runCommand("Go to Family tree");
    cy.get("[data-testid=family-tree]").invoke("attr", "data-zoom").then((before) => {
      cy.get("[data-testid=family-tree]").trigger("wheel", { deltaY: -400 });
      cy.get("[data-testid=family-tree]").should("not.have.attr", "data-zoom", before);
    });
    for (let i = 0; i < 8; i++) cy.get("[data-testid=family-tree-zoom-out]").click();
    cy.get("[data-testid=family-tree]").should("have.attr", "data-names", "hidden");
    cy.get("[data-testid=family-tree-name]").should("not.exist");
    cy.get("[data-testid=family-tree-person]").should("have.length.greaterThan", 10);
    cy.get("[data-testid=family-tree-fit]").click();
    cy.get("[data-testid=family-tree]").should("have.attr", "data-names", "shown");
    // A drag moves the drawing and opens no one.
    cy.get("[data-testid=family-tree-person]").first().then(($p) => {
      const x0 = $p[0].getBoundingClientRect().left;
      cy.get("[data-testid=family-tree]")
        .trigger("pointerdown", 20, 20, { pointerId: 1, button: 0, pointerType: "mouse" })
        .trigger("pointermove", 80, 40, { pointerId: 1, pointerType: "mouse" })
        .trigger("pointermove", 140, 60, { pointerId: 1, pointerType: "mouse" })
        .trigger("pointerup", 140, 60, { pointerId: 1, pointerType: "mouse" });
      cy.get("[data-testid=family-tree-person]")
        .first()
        .should(($q) => expect($q[0].getBoundingClientRect().left).to.be.closeTo(x0 + 120, 2));
    });
    cy.get("[data-testid=family-tree]").should("be.visible");
  });

  it("opens a person's Hub with Enter after the drawing was dragged", () => {
    cy.runCommand("Go to Family tree");
    cy.get("[data-testid=family-tree]")
      .trigger("pointerdown", 20, 20, { pointerId: 1, button: 0, pointerType: "mouse" })
      .trigger("pointermove", 60, 30, { pointerId: 1, pointerType: "mouse" })
      .trigger("pointermove", 100, 40, { pointerId: 1, pointerType: "mouse" })
      .trigger("pointerup", 100, 40, { pointerId: 1, pointerType: "mouse" });
    // The drag ended no click, and the keyboard is no drag.
    ids("Jacob").then(([jacob]) => {
      person(jacob).focus();
      cy.focused().should("have.attr", "data-id", jacob);
    });
    cy.press(Cypress.Keyboard.Keys.ENTER);
    cy.hubTitle("Jacob");
  });

  it("brings a person reached by Tab into view", () => {
    cy.runCommand("Go to Family tree");
    // Close in, so that most of the drawing is out of the box.
    for (let i = 0; i < 4; i++) cy.get("[data-testid=family-tree-zoom-in]").click();
    cy.get("[data-testid=family-tree]").then(($c) => {
      const box = $c[0].getBoundingClientRect();
      const inside = (r: DOMRect) =>
        r.left >= box.left - 1 && r.right <= box.right + 1 && r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
      cy.get("[data-testid=family-tree-person]").then(($p) => {
        const all = [...$p];
        const target = all.findIndex((e, i) => i > 0 && !inside(e.getBoundingClientRect()));
        expect(target, "a person out of view").to.be.greaterThan(0);
        const id = all[target].getAttribute("data-id")!;
        cy.wrap(all[target - 1]).focus();
        cy.press(Cypress.Keyboard.Keys.TAB);
        cy.focused().should("have.attr", "data-id", id);
        person(id).should(($q) => {
          const r = $q[0].getBoundingClientRect();
          expect(inside(r), `${id} in view: ${JSON.stringify(r)} / ${JSON.stringify(box)}`).to.equal(true);
        });
      });
    });
  });

  it("skips a cycle and draws the rest", () => {
    cy.bridge("create_document", { docType: "character", title: "Cain", fields: { father: "[[Enoch]]" }, body: "" });
    cy.bridge("create_document", { docType: "character", title: "Enoch", fields: { father: "[[Cain]]" }, body: "" });
    cy.openApp();
    cy.runCommand("Go to Family tree");
    ids("Cain", "Enoch", "Jacob").then(([cain, enoch, jacob]) => {
      person(jacob).should("have.length", 1);
      // The cycle's ties are left out: no line between the two.
      cy.get(`[data-testid=family-tree-line][data-child="${cain}"]`).should("not.exist");
      cy.get(`[data-testid=family-tree-line][data-child="${enoch}"]`).should("not.exist");
    });
  });

  it("shows an empty state with the Tutorial in a Vault where no Character has kin", () => {
    // The engine's answer for such a Vault: no edge, no warning, no Relation.
    cy.intercept("POST", "**/invoke/query", (req) => {
      if (req.body?.query?.kind === "kinship")
        req.reply({ body: { kind: "kinship", value: { edges: [], warnings: [], relations: [] } } });
      else req.continue();
    });
    cy.runCommand("Go to Family tree");
    cy.get("[data-testid=family-tree-empty]").should("be.visible");
    cy.get("[data-testid=family-tree]").should("not.exist");
    cy.get("[data-testid=family-tree-empty-tutorial]").click();
    cy.get("[data-testid=tutorial-body]").should("have.attr", "data-id", "family-tree");
  });
});
