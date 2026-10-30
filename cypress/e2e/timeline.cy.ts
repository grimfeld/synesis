// Timeline view: lanes by Subject, Events lane on top, zoom and pan.
describe("Timeline", () => {
  beforeEach(() => {
    // The type chips and the viewport cull persist in settings, so reset them
    // before each test rather than inheriting the previous one's filters.
    cy.bridge("set_timeline_filters", { hiddenTypes: [], inView: true });
    cy.openApp();
  });

  // The chips and the cull persist, so no test may leave the Vault filtered.
  afterEach(() =>
    cy.bridge("set_timeline_filters", { hiddenTypes: [], inView: true }),
  );

  it("draws an Events lane and one lane per dated Subject, earliest first", () => {
    cy.get("[data-testid=nav-timeline]").click();
    cy.get("h1").should("contain", "Timeline");
    cy.get("[data-testid=tl-lane]")
      .first()
      .should("have.attr", "data-lane", "events");
    // Thirteen Characters carry Dates, Adam and Noah first; a Place with a Date gets a lane too.
    cy.get("[data-testid=tl-lane][data-type=character]").should(
      "have.length",
      13,
    );
    cy.get("[data-testid=tl-lane][data-type=character]")
      .eq(0)
      .should("contain", "Adam");
    cy.get("[data-testid=tl-lane][data-type=character]")
      .eq(1)
      .should("contain", "Noah");
    // Jerusalem, and Judah, the region whose Border holds it.
    cy.get("[data-testid=tl-lane][data-type=place]").should("have.length", 2);
    cy.contains("[data-testid=tl-lane][data-type=place]", "Jerusalem").should("exist");
    cy.contains("[data-testid=tl-lane][data-type=place]", "Judah").should("exist");
    // At fit zoom the 1st-century Events collapse into Clusters, so the Lane's
    // marks and the counts on its Clusters together still account for all 19.
    cy.get("[data-testid=tl-lane][data-lane=events]").then(($lane) => {
      const single = $lane.find("[data-testid=tl-mark]").length;
      const clustered = [...$lane.find("[data-testid=tl-cluster]")].reduce(
        (n, el) => n + Number(el.getAttribute("data-count")),
        0,
      );
      expect(single + clustered).to.equal(19);
      expect(clustered).to.be.greaterThan(0);
    });
    // Narrowing to Paul leaves few enough Events that none of them Cluster.
    cy.get("[data-testid=tl-search]").type("Paul");
    cy.docByTitle("Paul in Ephesus").then((ev) => {
      // The Event sits on the Events lane and on the lanes of the Characters it names.
      cy.get(
        `[data-testid=tl-lane][data-lane=events] [data-testid=tl-mark][data-doc=${ev.id}]`,
      ).should("have.length", 1);
      cy.docByTitle("Paul").then((paul) => {
        cy.get(
          `[data-testid=tl-lane][data-lane=${paul.id}] [data-testid=tl-mark][data-doc=${ev.id}]`,
        ).should("have.length", 1);
      });
      cy.docByTitle("David").then((david) => {
        cy.get(`[data-testid=tl-lane][data-lane=${david.id}]`).should(
          "not.exist",
        );
      });
    });
    // Approximate Dates are drawn faded, once nothing Clusters over them.
    cy.get("[data-testid=tl-search]").clear().type("anointed");
    cy.docByTitle("David anointed king").then((ev) => {
      cy.get(
        `[data-testid=tl-lane][data-lane=events] [data-testid=tl-mark][data-doc=${ev.id}]`,
      ).should("have.attr", "data-approx", "true");
    });
    cy.get("[data-testid=tl-search]").clear();
  });

  it("zooms with the buttons and the wheel, fits back, and opens a mark", () => {
    cy.get("[data-testid=nav-timeline]").click();
    cy.get("[data-testid=timeline] svg").then(($svg) => {
      const span =
        Number($svg.attr("data-to")) - Number($svg.attr("data-from"));
      expect(span).to.be.greaterThan(2000);
      cy.get("button[aria-label='Zoom in']").click();
      cy.get("[data-testid=timeline] svg").should(($z) => {
        expect(
          Number($z.attr("data-to")) - Number($z.attr("data-from")),
        ).to.be.lessThan(span);
      });
      cy.get("[data-testid=timeline] svg").trigger("wheel", {
        deltaY: -600,
        clientX: 700,
        clientY: 100,
      });
      cy.get("[data-testid=timeline] svg").should(($z) => {
        expect(
          Number($z.attr("data-to")) - Number($z.attr("data-from")),
        ).to.be.lessThan(span / 2);
      });
      cy.get("button[aria-label='Fit all']").click();
      cy.get("[data-testid=timeline] svg").should(($z) => {
        expect(
          Number($z.attr("data-to")) - Number($z.attr("data-from")),
        ).to.equal(span);
      });
    });
    // Narrow first: at fit zoom this Event sits inside a Cluster.
    cy.get("[data-testid=tl-search]").type("Death of Jesus");
    cy.docByTitle("Death of Jesus").then((ev) => {
      cy.get(
        `[data-testid=tl-lane][data-lane=events] [data-testid=tl-mark][data-doc=${ev.id}]`,
      ).click({ force: true });
    });
    cy.get("[data-testid=hub-header]").should("contain", "Event");
    cy.hubTitle("Death of Jesus");
  });

  it("is reachable from the Command Palette", () => {
    cy.runCommand("Timeline");
    cy.get("h1").should("contain", "Timeline");
  });

  it("filters Lanes by kind, Tag, Date Property and title, and clears them", () => {
    cy.get("[data-testid=nav-timeline]").click();
    cy.get("[data-testid=tl-lane]").its("length").as("all");
    // Title search narrows to the Lanes that match, badge counts the restriction.
    cy.get("[data-testid=tl-search]").type("Paul");
    cy.get("[data-testid=tl-lane][data-type=character]")
      .should("have.length", 1)
      .and("contain", "Paul");
    cy.get("[data-testid=tl-filter]").should("have.attr", "data-active", "1");
    cy.get("[data-testid=tl-search]").clear();
    cy.get("@all").then((all) => {
      cy.get("[data-testid=tl-lane]").should("have.length", Number(all));
    });
    // Kinds are chips; hiding Characters leaves the Places and the Events Lane.
    cy.get("[data-testid=tl-filter]").click();
    cy.get("[data-slot=popover-content]").contains("button", "Characters").click();
    cy.get("[data-testid=tl-lane][data-type=character]").should("not.exist");
    cy.get("[data-testid=tl-lane][data-lane=events]").should("exist");
    cy.get("[data-slot=popover-content]").contains("button", "Characters").click();
    cy.get("[data-testid=tl-lane][data-type=character]").should("exist");
    // A Date Property filters both axes: only Lanes carrying `died`. The chip
    // reads "Died" — a built-in Property is labelled in the reader's language,
    // while the filter itself still holds the front-matter name.
    cy.get("[data-slot=popover-content]").contains("button", "Died").click();
    cy.get("@all").then((all) => {
      cy.get("[data-testid=tl-lane]").should("have.length.lessThan", Number(all));
    });
    cy.get("[data-testid=tl-filter-clear]").click();
    cy.get("@all").then((all) => {
      cy.get("[data-testid=tl-lane]").should("have.length", Number(all));
    });
  });

  it("says so when the filters match nothing, and clears them from there", () => {
    cy.get("[data-testid=nav-timeline]").click();
    cy.get("[data-testid=tl-search]").type("nothing matches this");
    cy.get("[data-testid=tl-empty]")
      .should("be.visible")
      .and("not.contain", "Nothing dated yet");
    // The plot stays: an empty result must still pan and zoom back into range.
    cy.get("[data-testid=timeline] svg").should("exist");
    cy.get("[data-testid=tl-empty-clear]").click();
    cy.get("[data-testid=tl-lane]").should("exist");
  });

  it("draws only the Lanes the view reaches, until the cull is turned off", () => {
    cy.get("[data-testid=nav-timeline]").click();
    cy.get("[data-testid=tl-lane]").its("length").then((all) => {
      // Zooming in drops the Lanes whose Dates fall outside the visible years.
      cy.get("button[aria-label='Zoom in']").click().click().click();
      cy.get("[data-testid=tl-lane]").should("have.length.lessThan", all);
      cy.get("[data-testid=tl-filter]").click();
      cy.get("[data-testid=tl-in-view]").uncheck();
      cy.get("[data-testid=tl-lane]").should("have.length", all);
      cy.get("[data-testid=tl-in-view]").check();
      cy.get("[data-testid=tl-lane]").should("have.length.lessThan", all);
    });
  });

  it("narrows to a Period, counts the undated, combines Tags, and clears it", () => {
    // Every Character in the demo vault is dated; Jael is not.
    cy.bridge("create_document", { docType: "character", title: "Jael", fields: {} });
    cy.openApp();
    cy.get("[data-testid=nav-timeline]").click();
    cy.get("[data-testid=period-text]").should("contain", "Period");
    cy.get("[data-testid=period-clear]").should("not.exist");
    // 1100–1000 BCE: David (1107–1037 BCE) overlaps it, Moses (1593–1473 BCE)
    // lies wholly before it. Both fields start in BCE.
    cy.get("[data-testid=period]").click();
    cy.get("[data-testid=period-from-era]").should("have.attr", "data-bce", "true");
    cy.get("[data-testid=period-from]").type("1100");
    cy.get("[data-testid=period-to]").type("1000");
    cy.get("body").type("{esc}");
    cy.get("[data-testid=period-text]").should("contain", "1100–1000 BCE");
    cy.docByTitle("David").then((david) =>
      cy.get(`[data-testid=tl-lane][data-lane=${david.id}]`).should("exist"),
    );
    cy.docByTitle("Moses").then((moses) =>
      cy.get(`[data-testid=tl-lane][data-lane=${moses.id}]`).should("not.exist"),
    );
    cy.get("[data-testid=period-undated]").should("contain", "1 undated not shown");
    // The Period stays set across a trip to another view and back.
    cy.get("[data-testid=nav-home]").click();
    cy.get("[data-testid=nav-timeline]").click();
    cy.get("[data-testid=period-text]").should("contain", "1100–1000 BCE");
    // A Tag narrows further: of the Events, only the Temple is tagged "prayer"
    // within the Period, and no Character carries it.
    cy.get("[data-testid=tl-filter]").click();
    cy.get("[data-slot=popover-content]").contains("button", "prayer").click();
    cy.get("body").type("{esc}");
    cy.get("[data-testid=tl-lane][data-type=character]").should("not.exist");
    cy.docByTitle("Solomon's temple built").then((ev) =>
      cy
        .get(`[data-testid=tl-lane][data-lane=events] [data-doc=${ev.id}]`)
        .should("exist"),
    );
    // Jael carries no "prayer" Tag, so the Period no longer leaves her out.
    cy.get("[data-testid=period-undated]").should("not.exist");
    // Clearing the Period brings the whole chronology back; the Tag stays.
    cy.get("[data-testid=period-clear]").click();
    cy.get("[data-testid=period-text]").should("contain", "Period");
    cy.docByTitle("The Exodus").then((ev) =>
      cy
        .get(`[data-testid=tl-lane][data-lane=events] [data-doc=${ev.id}]`)
        .should("exist"),
    );
  });

  // Places in the shared filter (CONTEXT.md: Period, Character): a Character
  // is in a Place for life through its `places`, or for an Event's time
  // through an Event naming both.
  const pickPlace = (title: string) => {
    cy.get("[data-testid=period-places]").click();
    cy.get("[data-testid=period-places-search]").clear().type(title);
    cy.docByTitle(title).then((p) =>
      cy.get(`[data-testid=period-place-option][data-id="${p.id}"]`).click(),
    );
    cy.get("body").type("{esc}");
  };
  const lane = (title: string) =>
    cy.docByTitle(title).then((d) => cy.get(`[data-testid=tl-lane][data-lane=${d.id}]`));
  const eventMark = (title: string) =>
    cy
      .docByTitle(title)
      .then((ev) => cy.get(`[data-testid=tl-lane][data-lane=events] [data-doc=${ev.id}]`));

  it("narrows to the Places chosen, any of them, and what is tied to them", () => {
    cy.get("[data-testid=nav-timeline]").click();
    // David names Bethlehem in his `places`; David is anointed there.
    pickPlace("Bethlehem");
    cy.docByTitle("Bethlehem").then((p) =>
      cy.get(`[data-testid=period-place][data-id="${p.id}"]`).should("exist"),
    );
    lane("David").should("exist");
    lane("Moses").should("not.exist");
    eventMark("David anointed king").should("exist");
    eventMark("Solomon's temple built").should("not.exist");
    // Several Places are any of them: Paul is in Ephesus during his stay.
    pickPlace("Ephesus");
    lane("David").should("exist");
    lane("Paul").should("exist");
    eventMark("Paul in Ephesus").should("exist");
    // In 1100–1000 BCE only Bethlehem's ties hold.
    cy.get("[data-testid=period]").click();
    cy.get("[data-testid=period-from]").type("1100");
    cy.get("[data-testid=period-to]").type("1000");
    cy.get("body").type("{esc}");
    lane("David").should("exist");
    lane("Paul").should("not.exist");
    // Removing Bethlehem leaves nothing tied to Ephesus in those years.
    cy.docByTitle("Bethlehem").then((p) =>
      cy.get(`[data-testid=period-place][data-id="${p.id}"] [data-testid=period-place-remove]`).click(),
    );
    cy.get("[data-testid=tl-lane][data-type=character]").should("not.exist");
    cy.get("[data-testid=tl-empty-clear]").click();
    cy.get("[data-testid=period-place]").should("not.exist");
    lane("Moses").should("exist");
  });

  // A region takes in every Place inside its Border (ADR 0023): the demo
  // vault's Judah holds Jerusalem, Bethlehem and Anathoth.
  it("answers prophets in Judah, 640–580 BCE, through Judah's Border", () => {
    cy.get("[data-testid=nav-timeline]").click();
    pickPlace("Judah");
    // Jeremiah names Anathoth and Jerusalem, both inside Judah's Border;
    // David names Bethlehem and Jerusalem. Moses names no Place in it.
    lane("Jeremiah").should("exist");
    lane("David").should("exist");
    lane("Moses").should("not.exist");
    cy.get("[data-testid=tl-filter]").click();
    cy.get("[data-slot=popover-content]").contains("button", "prophet").click();
    cy.get("body").type("{esc}");
    lane("David").should("not.exist");
    lane("Isaiah").should("exist");
    cy.get("[data-testid=period]").click();
    cy.get("[data-testid=period-from]").type("640");
    cy.get("[data-testid=period-to]").type("580");
    cy.get("body").type("{esc}");
    cy.get("[data-testid=period-text]").should("contain", "640–580 BCE");
    // Isaiah died long before; Jeremiah is the prophet of those years.
    cy.get("[data-testid=tl-lane][data-type=character]")
      .should("have.length", 1)
      .and("contain", "Jeremiah");
    // The same question on the Map: Judah's Border, and the Places in it
    // where a prophet is in those years.
    cy.runCommand("Go to Map");
    cy.docByTitle("Judah").then((judah) =>
      cy.get(`[data-testid=map-border][data-id="${judah.id}"]`).should("exist"),
    );
    cy.docByTitle("Jerusalem").then((p) =>
      cy.get(`[data-testid=map] [data-testid=map-pin][data-id="${p.id}"]`).should("exist"),
    );
    cy.docByTitle("Bethlehem").then((p) =>
      cy.get(`[data-testid=map] [data-testid=map-pin][data-id="${p.id}"]`).should("not.exist"),
    );
    cy.docByTitle("Corinth").then((p) =>
      cy.get(`[data-testid=map] [data-testid=map-pin][data-id="${p.id}"]`).should("not.exist"),
    );
  });

  it("keeps the Places chosen on the Timeline when the Map opens", () => {
    cy.get("[data-testid=nav-timeline]").click();
    pickPlace("Jerusalem");
    cy.runCommand("Go to Map");
    cy.docByTitle("Jerusalem").then((p) => {
      cy.get(`[data-testid=period-place][data-id="${p.id}"]`).should("exist");
      cy.get("[data-testid=map] [data-testid=map-pin]")
        .should("have.length", 1)
        .and("have.attr", "data-id", p.id);
    });
  });

  it("gathers crowded Dates into a Cluster that opens and zooms apart", () => {
    cy.get("[data-testid=nav-timeline]").click();
    cy.get("[data-testid=tl-lane][data-lane=events] [data-testid=tl-cluster]")
      .first()
      .as("cluster");
    cy.get("@cluster").should("have.attr", "data-count");
    // Hovering lists the members; each one opens its own Hub.
    cy.get("@cluster").trigger("pointerover", { force: true });
    cy.get("[data-testid=tl-cluster-card]").should("be.visible");
    cy.get("[data-testid=tl-cluster-card] button").first().click();
    cy.get("[data-testid=hub-header]").should("exist");
    // Clicking a Cluster zooms to its own extent, which splits it.
    cy.get("[data-testid=nav-timeline]").click();
    cy.get("[data-testid=timeline] svg").then(($svg) => {
      const span = Number($svg.attr("data-to")) - Number($svg.attr("data-from"));
      cy.get("[data-testid=tl-lane][data-lane=events] [data-testid=tl-cluster]")
        .first()
        .click({ force: true });
      cy.get("[data-testid=timeline] svg").should(($z) => {
        expect(
          Number($z.attr("data-to")) - Number($z.attr("data-from")),
        ).to.be.lessThan(span);
      });
    });
  });
});
