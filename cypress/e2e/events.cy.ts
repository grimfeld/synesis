// Events (a Topical Subject) and Dates (ADR 0005) on Hub pages.
describe("Events and Dates", () => {
  beforeEach(() => cy.openApp());

  it("Event hub: dates as written, Place and Characters as link properties", () => {
    cy.openDoc("Paul in Ephesus");
    cy.get("[data-testid=right-panel]").should("not.exist");
    cy.get("[data-testid=hub-header]").should("contain", "Event");
    // The Span a type suggests is editable in place, so its value is the
    // field's, not the row's text.
    cy.get("[data-testid=hub-dates] [data-testid=date-start]").should(
      "have.attr",
      "data-valid",
      "true",
    );
    cy.get("[data-testid=date-input-start]").should("have.value", "c. 52 CE");
    cy.get("[data-testid=date-input-end]").should("have.value", "c. 55 CE");
    cy.get("[data-testid=property-place]").should(
      "have.attr",
      "data-prop-type",
      "link",
    );
    cy.get("[data-testid=property-place] input").should(
      "have.value",
      "[[Ephesus]]",
    );
    cy.get("[data-testid=property-characters]").should(
      "have.attr",
      "data-prop-type",
      "list",
    );
    // Ac 19:8-10 in the body is a Mention like anywhere else.
    cy.get("[data-testid=hub-about]").should("contain", "Tyrannus");
  });

  it("Character hub: open-ended Date properties and the Events naming it", () => {
    cy.openDoc("David");
    cy.get("[data-testid=date-input-born]").should("have.value", "c. 1107 BCE");
    cy.get("[data-testid=date-input-died]").should("have.value", "1037 BCE");
    // "anointed" is a user-declared Date in .bible-study/properties.json. It is
    // not part of the Span a Character suggests, so it stays a read-only row
    // below — and reads as the user named it, having no label of the app's.
    cy.get("[data-testid=hub-dates] [data-testid=date-anointed]")
      .should("have.attr", "data-valid", "true")
      .and("contain", "anointed");
    cy.get("[data-testid=hub-events]").should("contain", "David anointed king");
    cy.openDoc("Bethlehem");
    cy.get("[data-testid=hub-events]").should("contain", "David anointed king");
  });

  it("a Date the app cannot read is kept, flagged, and off the Timeline", () => {
    cy.openDoc("The Flood");
    // An Event's `end` is half its Span, so the Dates section owns it and the
    // Properties panel does not offer it a second time.
    cy.get("[data-testid=property-end]").should("not.exist");
    cy.get("[data-testid=date-input-end]").clear().type("whenever").blur();
    cy.get("[data-testid=hub-dates] [data-testid=date-end]").should(
      "have.attr",
      "data-valid",
      "false",
    );
    cy.get("[data-testid=date-input-end]").should("have.value", "whenever");
    cy.get("[data-testid=hub-dates] [data-testid=date-start]").should(
      "have.attr",
      "data-valid",
      "true",
    );
    cy.docByTitle("The Flood").then((d) => {
      cy.query<{ doc: { id: string }; name: string }[]>({ kind: "timeline" }).then(
        (rows) => {
          const mine = rows.filter((r) => r.doc.id === d.id).map((r) => r.name);
          expect(mine).to.deep.equal(["start"]);
        },
      );
    });
  });

  it("New Event lands in Events/ with its template", () => {
    cy.runCommand("New Event");
    cy.get("[data-testid=new-doc-form]").should("contain", "Event");
    cy.get("[data-testid=new-doc-form] input").first().type("Pentecost 33");
    cy.get("[data-testid=new-start]").type("Sivan 33 CE");
    cy.get("[data-testid=new-doc-form]").contains("button", "Create").click();
    cy.get("[data-testid=hub-header]").should("contain", "Event");
    cy.get("[data-testid=date-input-start]").should(
      "have.value",
      "Sivan 33 CE",
    );
    cy.docByTitle("Pentecost 33").then((d) => {
      expect(d.path).to.match(/^Events\//);
    });
    cy.get("[data-sidebar=content]").should("contain", "Events");
  });

  it("shows a mini-timeline on a dated Subject's Hub, and opens the Timeline from it", () => {
    cy.openDoc("Abraham");
    cy.get("[data-testid=hub-minitimeline]").should("be.visible");
    // Two rows: the Subject's own Dates, then the Events naming it.
    cy.get("[data-testid=mini-lane][data-lane=own]").should("exist");
    cy.get("[data-testid=mini-lane][data-lane=events]").should("exist");
    // The text lists stay: they carry the Dates a timeline cannot draw.
    cy.get("[data-testid=hub-dates] [data-testid=date-born]").should("exist");
    // A mark opens the document it stands for.
    cy.get("[data-testid=mini-lane][data-lane=events] [data-testid=mini-mark]")
      .first()
      .click({ force: true });
    cy.get("[data-testid=hub-header]").should("contain", "Event");
    // "Open in Timeline" lands on the Timeline scoped to this Subject.
    cy.openDoc("Abraham");
    cy.get("[data-testid=tl-open-full]").click();
    cy.get("h1").should("contain", "Timeline");
    cy.get("[data-testid=tl-search]").should("have.value", "Abraham");
    cy.get("[data-testid=tl-lane][data-type=character]")
      .should("have.length", 1)
      .and("contain", "Abraham");
  });

  it("an Event's own Hub shows its Date alone, with no Events row", () => {
    cy.openDoc("The Flood");
    cy.get("[data-testid=hub-minitimeline]").should("be.visible");
    cy.get("[data-testid=mini-lane]").should("have.length", 1);
    cy.get("[data-testid=mini-lane][data-lane=events]").should("not.exist");
  });
});

// Wherever an Event is listed outside its own Hub, its Date follows its title
// (PLAN §18): as written, `start – end` for a span, and the Hub's Events list
// runs oldest first.
describe("Events listed elsewhere carry their Date", () => {
  beforeEach(() => cy.openApp());

  it("a Place hub lists its Events with their Dates, oldest first", () => {
    cy.openDoc("Jerusalem");
    cy.get("[data-testid=hub-events] li").first().should("contain", "David king over all Israel");
    cy.get("[data-testid=hub-events] li").first().find("[data-testid=event-date]").should("have.text", "1070 BCE");
    cy.get("[data-testid=hub-events] li").last().should("contain", "Destruction of Jerusalem by Rome");
    cy.get("[data-testid=hub-events] li").last().find("[data-testid=event-date]").should("have.text", "70 CE");
    // A span shows both ends, exactly as written.
    cy.get("[data-testid=hub-events]").contains("li", "Solomon's temple built").find("[data-testid=event-date]").should("have.text", "1034 BCE – 1027 BCE");
  });

  it("the palette shows an Event's Date next to its title", () => {
    cy.palette("Paul in Ephesus");
    cy.get("[data-testid=palette] [cmdk-item]")
      .contains("[cmdk-item]", "Paul in Ephesus")
      .find("[data-testid=event-date]")
      .should("have.text", "c. 52 CE – c. 55 CE");
  });

  it("a Character's own Dates never read as an Event Date", () => {
    cy.palette("David");
    cy.get("[data-testid=palette] [cmdk-item]")
      .contains("[cmdk-item]", "David")
      .first()
      .find("[data-testid=event-date]")
      .should("not.exist");
  });

  it("offers a Character its Span even when it has no Dates at all", () => {
    // The complaint this exists for: a Character with nothing dated showed no
    // Dates section, so the way to record a lifespan was to know that a
    // Property called `born` existed and to add it in the Properties panel.
    cy.runCommand("New Character");
    cy.get("[data-testid=new-doc-form] input").first().type("Jael");
    cy.get("[data-testid=new-doc-form]").contains("button", "Create").click();
    cy.get("[data-testid=hub-header]").should("contain", "Character");
    cy.get("[data-testid=date-input-born]").should("have.value", "");
    cy.get("[data-testid=date-input-died]").should("have.value", "");
    // Labelled by what the Property means, not by its key.
    cy.get("[data-testid=hub-dates]").should("contain", "Born");
    cy.get("[data-testid=hub-dates]").should("contain", "Died");

    // Filling one writes it to the front matter under its real name.
    cy.get("[data-testid=date-input-born]").type("c. 1250 BCE").blur();
    cy.get("[data-testid=hub-dates] [data-testid=date-born]").should(
      "have.attr",
      "data-valid",
      "true",
    );
    cy.docByTitle("Jael").then((d) => {
      cy.query<{ name: string; text: string }[]>({
        kind: "datesOf",
        id: d.id,
      }).then((dates) => {
        expect(dates.map((x) => x.name)).to.deep.equal(["born"]);
        expect(dates[0].text).to.equal("c. 1250 BCE");
      });
    });

    // Emptying it takes the Property away rather than leaving `born:` blank.
    cy.get("[data-testid=date-input-born]").clear().blur();
    cy.docByTitle("Jael").then((d) => {
      cy.query<unknown[]>({ kind: "datesOf", id: d.id }).should("be.empty");
    });
  });

  it("does not offer a Span to a type with no date convention", () => {
    // A Place carries lat/lon; offering it born/died would invent a convention
    // the vault does not have.
    cy.openDoc("Ephesus");
    cy.get("[data-testid=date-input-born]").should("not.exist");
    cy.get("[data-testid=date-input-start]").should("not.exist");
  });

  it("writes a Character's Span from the New dialog", () => {
    cy.runCommand("New Character");
    cy.get("[data-testid=new-doc-form] input").first().type("Deborah");
    cy.get("[data-testid=new-born]").type("c. 1280 BCE");
    cy.get("[data-testid=new-died]").type("c. 1200 BCE");
    cy.get("[data-testid=new-doc-form]").contains("button", "Create").click();
    cy.get("[data-testid=date-input-born]").should("have.value", "c. 1280 BCE");
    cy.get("[data-testid=date-input-died]").should("have.value", "c. 1200 BCE");
    // A pair of Dates is a Span, so the Hub draws one.
    cy.get("[data-testid=hub-minitimeline]").should("be.visible");
  });

  it("keeps the Span out of the Properties panel, which edits it above", () => {
    cy.openDoc("David");
    cy.get("[data-testid=property-born]").should("not.exist");
    cy.get("[data-testid=property-died]").should("not.exist");
    // A Date the app does not own is still the panel's to offer.
    cy.get("[data-testid=property-anointed]").should("exist");
  });
});
