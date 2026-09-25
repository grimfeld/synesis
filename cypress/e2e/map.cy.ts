// The Map view (PLAN §19): today's baseline — every Place with coordinates
// plots, and a marker opens its Hub. Tiles are unreliable offline, so the view
// is asserted through the `data-zoom` / `data-center` hooks MapView exposes.
describe("Map", () => {
  beforeEach(() => cy.openApp());

  it("plots every Place that has coordinates", () => {
    cy.runCommand("Go to Map");
    cy.get("[data-testid=map]").should("exist");
    // The demo vault's Places all carry looked-up coordinates (PLAN §14 step 5).
    cy.query<{ id: string; title: string }[]>({ kind: "places" }).then((places) => {
      expect(places.length, "Places with coordinates").to.be.greaterThan(0);
      cy.get("[data-testid=map] .leaflet-interactive").should(
        "have.length",
        places.length,
      );
      // Each one is labelled by its title.
      cy.get("[data-testid=map] .map-label").should(
        "have.length",
        places.length,
      );
    });
  });

  it("fits the view to the Places rather than staying at the default", () => {
    cy.runCommand("Go to Map");
    // The initial center is Jerusalem-ish at zoom 6; fitting the demo vault's
    // spread (Rome to Babylon) has to pull back from it.
    cy.get("[data-testid=map]")
      .should("have.attr", "data-zoom")
      .and((z) => {
        expect(Number(z)).to.be.lessThan(6);
      });
  });

  it("opens a Place's Hub when its marker is clicked", () => {
    cy.runCommand("Go to Map");
    // Labels are tooltips (`pointer-events: none`), so the marker is the target.
    // Markers are added in the order `places()` returns them, which is by title.
    cy.query<{ title: string }[]>({ kind: "places" }).then((places) => {
      const i = places.findIndex((p) => p.title === "Corinth");
      expect(i, "Corinth among the plotted Places").to.be.at.least(0);
      cy.get("[data-testid=map] .leaflet-interactive").eq(i).click();
    });
    cy.hubTitle("Corinth");
    cy.get("[data-testid=hub-header]").should("contain", "Place");
  });

  it("offers New Place from the header", () => {
    cy.runCommand("Go to Map");
    cy.get("[data-testid=map]").should("exist");
    // Scoped to the header: the sidebar's Places tree also contains "Place".
    cy.get("header").contains("button", "Place").click();
    cy.get("[data-testid=new-doc-form]").should("contain", "Place");
  });

  // The four filter axes (PLAN §19.5): AND across them, OR within each.
  const markers = () => cy.get("[data-testid=map] .leaflet-interactive");

  it("narrows to matching titles as you search", () => {
    cy.runCommand("Go to Map");
    markers().its("length").as("all");
    cy.get("[data-testid=map-search]").type("corin");
    markers().should("have.length", 1);
    cy.get("[data-testid=map] .map-label").should("contain", "Corinth");
    cy.get("[data-testid=map-search]").clear();
    cy.get<number>("@all").then((n) =>
      markers().should("have.length", n),
    );
  });

  it("shows the filtered-empty state and clears it", () => {
    cy.runCommand("Go to Map");
    cy.get("[data-testid=map-search]").type("nowhere at all");
    cy.get("[data-testid=map-empty]").should("be.visible");
    markers().should("have.length", 0);
    cy.get("[data-testid=map-empty-clear]").click();
    cy.get("[data-testid=map-empty]").should("not.exist");
    markers().its("length").should("be.greaterThan", 0);
  });

  it("counts active filters on the popover badge", () => {
    cy.runCommand("Go to Map");
    cy.get("[data-testid=map-filter]").should("have.attr", "data-active", "0");
    cy.get("[data-testid=map-search]").type("corinth");
    cy.get("[data-testid=map-filter]").should("have.attr", "data-active", "1");
    cy.get("[data-testid=map-filter]").click();
    cy.get("[data-testid=map-mentioned-only]").check();
    cy.get("[data-testid=map-filter]").should("have.attr", "data-active", "2");
    cy.get("[data-testid=map-filter-clear]").click();
    cy.get("[data-testid=map-filter]").should("have.attr", "data-active", "0");
  });

  it("filters to the Places a Book mentions", () => {
    cy.runCommand("Go to Map");
    markers().its("length").as("all");
    cy.get("[data-testid=map-filter]").click();
    // Book chips are only offered for Books that some Place is mentioned in.
    cy.get("[data-testid=map-filter]")
      .parent()
      .then(() => cy.get("[role=group] button").first().click());
    cy.get("body").type("{esc}");
    cy.get<number>("@all").then((n) =>
      markers().its("length").should("be.lessThan", n + 1),
    );
  });

  // Journeys drawn as routes (PLAN §19.3, §19.7, §19.10).
  it("draws a Journey's route only when its chip is on", () => {
    cy.runCommand("Go to Map");
    cy.get("[data-testid=map] .map-route").should("not.exist");
    cy.get("[data-testid=map-filter]").click();
    cy.contains("button", "Paul's second missionary journey").click();
    cy.get("body").type("{esc}");
    // One polyline per drawable leg, plus an arrowhead on each.
    cy.get("[data-testid=map] .map-route").should("have.length.greaterThan", 0);
    cy.get("[data-testid=map] .map-arrow").should("have.length.greaterThan", 0);
    // Journey chips add Places rather than hiding any, so the badge stays at 0.
    cy.get("[data-testid=map-filter]").should("have.attr", "data-active", "0");
  });

  it("numbers a Stop by its place in the whole route, both visits included", () => {
    cy.runCommand("Go to Map");
    cy.get("[data-testid=map-filter]").click();
    cy.contains("button", "Paul's second missionary journey").click();
    cy.get("body").type("{esc}");
    // Antioch opens and closes the route: one marker carrying both numbers.
    cy.get("[data-testid=map] .map-label")
      .contains("Antioch")
      .should("contain", "1")
      .and("contain", "6");
  });

  it("shows a Journey's Stops even when the filters exclude them", () => {
    cy.runCommand("Go to Map");
    // A search that matches no Place at all would normally empty the Map.
    cy.get("[data-testid=map-search]").type("zzzznowhere");
    cy.get("[data-testid=map-empty]").should("be.visible");
    cy.get("[data-testid=map-filter]").click();
    cy.contains("button", "Paul's second missionary journey").click();
    cy.get("body").type("{esc}");
    // The route's Stops come back regardless (§19.7).
    cy.get("[data-testid=map-empty]").should("not.exist");
    cy.get("[data-testid=map] .map-label").should("contain", "Antioch");
  });

  it("lists the Stops a Journey cannot draw, and opens the Map from the Hub", () => {
    cy.openDoc("Paul's second missionary journey");
    cy.get("[data-testid=journey-stops]").should("exist");
    cy.get("[data-testid=journey-stop]").should("have.length", 6);
    // Troas has no coordinates in the demo vault, so it is reported, not hidden.
    cy.get("[data-testid=journey-stop][data-status=no_coords]")
      .should("have.length", 1)
      .and("contain", "Troas");
    cy.get("[data-testid=journey-undrawable]").should("exist");
    cy.get("[data-testid=journey-show-on-map]").click();
    cy.get("[data-testid=map]").should("exist");
    cy.get("[data-testid=map] .map-route").should("have.length.greaterThan", 0);
  });

  it("reorders a Journey's Stops from its Hub", () => {
    cy.openDoc("The Exodus route");
    cy.get("[data-testid=journey-stop]")
      .first()
      .should("contain", "Egypt");
    cy.get("[data-testid=journey-stop]")
      .eq(1)
      .find("button[aria-label='Move earlier']")
      .click();
    cy.get("[data-testid=journey-stop]")
      .first()
      .should("contain", "Mount Sinai");
  });

  it("adds a Place the Vault holds as the last Stop", () => {
    cy.openDoc("The Exodus route");
    cy.get("[data-testid=journey-stop]").its("length").then((n) => {
      cy.get("[data-testid=journey-add-stop]").click();
      cy.get("[data-testid=journey-stop-input]").type("bab");
      cy.get("[data-testid=journey-stop-option]").first().should("have.attr", "data-kind", "place").and("contain", "Babylon").click();
      cy.get("[data-testid=journey-stop]").should("have.length", n + 1).last().should("contain", "Babylon").and("have.attr", "data-status", "ok");
      // Still open for the next Stop, and empty.
      cy.get("[data-testid=journey-stop-input]").should("have.value", "");
    });
    cy.wait(1000);
    cy.docByTitle("The Exodus route").then((d) => {
      cy.task<string>("file:read", `${Cypress.env("vault")}/${d.path}`).then((text) => {
        expect(text).to.match(/places: \[.*"\[\[Babylon\]\]"\]/);
      });
    });
  });

  it("makes a Stop from the Bible-place gazetteer, coordinates and all", () => {
    cy.openDoc("Paul's second missionary journey");
    cy.get("[data-testid=journey-add-stop]").click();
    cy.get("[data-testid=journey-stop-input]").type("philippi");
    cy.get("[data-testid=journey-stop-option][data-kind=gazetteer]").first().should("contain", "Philippi").click();
    cy.get("[data-testid=journey-stop]").last().should("contain", "Philippi").and("have.attr", "data-status", "ok");
    cy.docByTitle("Philippi").then((d) => {
      expect(d.type).to.equal("place");
      cy.task<string>("file:read", `${Cypress.env("vault")}/${d.path}`).then((text) => {
        expect(text).to.match(/lat: 4\d\./);
        expect(text).to.match(/lon: 2\d\./);
      });
    });
    // A Place the Vault now holds is offered as itself, not created twice.
    cy.get("[data-testid=journey-stop-input]").type("philippi");
    cy.get("[data-testid=journey-stop-option]").first().should("have.attr", "data-kind", "place");
    cy.get("[data-testid=journey-stop-close]").click();
    cy.get("[data-testid=journey-add-stop]").should("exist");
  });

  it("keeps the Book filter across a round-trip to a Hub", () => {
    cy.runCommand("Go to Map");
    cy.get("[data-testid=map-filter]").click();
    cy.get("[data-testid=map-mentioned-only]").check();
    cy.get("body").type("{esc}");
    cy.get("[data-testid=map-filter]").should("have.attr", "data-active", "1");
    cy.openDoc("Corinth");
    cy.hubTitle("Corinth");
    cy.runCommand("Go to Map");
    // Persisted through engine settings (PLAN §19.13), so it survives.
    cy.get("[data-testid=map-filter]").should("have.attr", "data-active", "1");
    cy.get("[data-testid=map-filter]").click();
    cy.get("[data-testid=map-filter-clear]").click();
  });
});
