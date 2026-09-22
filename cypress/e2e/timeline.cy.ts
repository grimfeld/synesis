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
    // Eleven Characters carry Dates, Adam and Noah first; a Place with a Date gets a lane too.
    cy.get("[data-testid=tl-lane][data-type=character]").should(
      "have.length",
      11,
    );
    cy.get("[data-testid=tl-lane][data-type=character]")
      .eq(0)
      .should("contain", "Adam");
    cy.get("[data-testid=tl-lane][data-type=character]")
      .eq(1)
      .should("contain", "Noah");
    cy.get("[data-testid=tl-lane][data-type=place]")
      .should("have.length", 1)
      .and("contain", "Jerusalem");
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
    cy.get("[data-testid=tl-lane]").should("have.length.lessThan", 13);
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
