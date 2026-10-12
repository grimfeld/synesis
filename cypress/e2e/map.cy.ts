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
      cy.get("[data-testid=map] [data-testid=map-pin]").should(
        "have.length",
        places.length,
      );
      // Each one is labelled by its title (some hidden by collisions, §27.10).
      cy.get("[data-testid=map] .map-name").should(
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
    // The pin, not the name: a name may be hidden where Places crowd (§27.10),
    // and a neighbour's pin may overlap at the fitted zoom, hence `force`.
    cy.contains("[data-testid=map-pin]", "Corinth").find(".map-pin").click({ force: true });
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
  const markers = () => cy.get("[data-testid=map] [data-testid=map-pin]");

  it("narrows to matching titles as you search", () => {
    cy.runCommand("Go to Map");
    markers().its("length").as("all");
    cy.get("[data-testid=map-search]").type("corin");
    markers().should("have.length", 1);
    cy.get("[data-testid=map] .map-name").should("contain", "Corinth");
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
    cy.get("[data-testid=map-filter-books] button").first().click();
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
    // Antioch opens and closes the route: one pin carrying both numbers, in
    // the badge on its edge rather than in its name (§27.7).
    cy.contains("[data-testid=map-pin]", "Antioch")
      .find("[data-testid=map-stop-number]")
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
    cy.get("[data-testid=map] .map-name").should("contain", "Antioch");
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

  // Place kinds, colour and the legend (PLAN §27).
  it("draws each Place's kind as the shape of its pin, and a region as a name alone", () => {
    cy.runCommand("Go to Map");
    cy.contains("[data-testid=map-pin]", "Mount Sinai")
      .should("have.attr", "data-kind", "mountain")
      .find(".map-pin svg")
      .should("exist");
    cy.contains("[data-testid=map-pin]", "Jordan").should("have.class", "map-place--water");
    // Egypt is a region: no pin, only its name (§27.11).
    cy.contains("[data-testid=map-pin]", "Egypt")
      .should("have.attr", "data-kind", "region")
      .and("have.class", "no-pin")
      .find(".map-pin")
      .should("not.exist");
    // Colour by Kind is the default.
    cy.contains("[data-testid=map-pin]", "Gethsemane").should("have.attr", "data-colors", "--c-kind-site");
  });

  it("lists only the kinds on screen in the legend", () => {
    cy.runCommand("Go to Map");
    cy.get("[data-testid=map-legend]").should("be.visible");
    cy.get("[data-testid=map-legend-kind]").should("have.length", 5);
    cy.get("[data-testid=map-search]").type("sinai");
    cy.get("[data-testid=map-legend-kind]").should("have.length", 1).and("contain", "Mountain");
  });

  it("colours chosen Books, splits a Place in both, and mutes the rest", () => {
    cy.runCommand("Go to Map");
    cy.get("[data-testid=map-filter]").click();
    cy.get("[data-testid=map-color-by-book]").click();
    cy.get("[data-testid=map-color-values] button").contains("Exodus").click();
    cy.get("[data-testid=map-color-values] button").contains("1 Kings").click();
    cy.get("body").type("{esc}");
    // Colour hides nothing, so it does not count as a filter.
    cy.get("[data-testid=map-filter]").should("have.attr", "data-active", "0");
    cy.contains("[data-testid=map-pin]", "Jerusalem")
      .should("have.attr", "data-colors", "--c-route-1 --c-route-2")
      .find(".map-pin-disc path")
      .should("have.length", 2);
    cy.contains("[data-testid=map-pin]", "Mount Sinai").should("have.attr", "data-colors", "--c-route-1");
    cy.contains("[data-testid=map-pin]", "Rome").should("have.class", "is-muted");
    cy.get("[data-testid=map-legend-color]").should("have.length", 2);
    // The legend's ✕ is the quick way to drop a value from the comparison.
    cy.get("[data-testid=map-legend-uncolor]").first().click();
    cy.contains("[data-testid=map-pin]", "Mount Sinai").should("have.class", "is-muted");
    cy.get("[data-testid=map-legend-color]").should("have.length", 1).and("contain", "1 Kings");
  });

  it("keeps a Stop in its route's colour whatever the rule", () => {
    cy.runCommand("Go to Map");
    cy.get("[data-testid=map-filter]").click();
    cy.get("[data-testid=map-color-by-none]").click();
    cy.get("[data-testid=map-filter-journeys] button").contains("Paul's second missionary journey").click();
    cy.get("body").type("{esc}");
    cy.contains("[data-testid=map-pin]", "Antioch").should("have.attr", "data-colors").and("match", /--c-route-/);
    cy.contains("[data-testid=map-pin]", "Babylon").should("have.attr", "data-colors", "--c-place");
    cy.get("[data-testid=map-legend-journey]").should("contain", "Paul's second missionary journey");
  });

  it("remembers Colour by across a round-trip, and the legend's state per Device", () => {
    cy.runCommand("Go to Map");
    cy.get("[data-testid=map-filter]").click();
    cy.get("[data-testid=map-color-by-tag]").click();
    cy.get("body").type("{esc}");
    cy.get("[data-testid=map-legend-close]").click();
    cy.get("[data-testid=map-legend]").should("not.exist");
    cy.openDoc("Corinth");
    cy.hubTitle("Corinth");
    cy.runCommand("Go to Map");
    cy.get("[data-testid=map-legend-open]").click();
    cy.get("[data-testid=map-legend]").should("contain", "Tag");
    cy.get("[data-testid=map-filter]").click();
    cy.get("[data-testid=map-color-by-tag]").should("have.attr", "data-state", "on");
    cy.get("[data-testid=map-color-by-kind]").click();
  });

  it("sets a Place's kind from its Hub, and makes a custom kind in place", () => {
    cy.openDoc("Corinth");
    cy.hubTitle("Corinth");
    cy.get("[data-testid=kind-picker]").should("have.attr", "data-kind", "settlement").click();
    cy.get("[data-testid=kind-option][data-kind=site]").click();
    cy.get("[data-testid=kind-picker]").should("have.attr", "data-kind", "site");
    cy.get("[data-testid=kind-picker]").click();
    cy.get("[data-testid=kind-new]").click();
    cy.get("[data-testid=kind-new-name]").type("Harbour");
    cy.get("[data-testid=kind-icon][data-icon=anchor]").click();
    cy.get("[data-testid=kind-new-save]").click();
    cy.get("[data-testid=kind-picker]").should("have.attr", "data-kind", "Harbour");
    cy.wait(1000);
    cy.docByTitle("Corinth").then((d) => {
      cy.task<string>("file:read", `${Cypress.env("vault")}/${d.path}`).then((text) => {
        expect(text).to.match(/^kind: Harbour$/m);
      });
    });
    // Kept in the Vault's config, so Paired Devices draw the same pin (§27.4).
    cy.task<string>("file:read", `${Cypress.env("vault")}/.bible-study/place-kinds.json`).then((text) => {
      expect(JSON.parse(text).kinds).to.deep.equal([{ name: "Harbour", label: "Harbour", icon: "anchor" }]);
    });
    cy.runCommand("Go to Map");
    cy.contains("[data-testid=map-pin]", "Corinth")
      .should("have.attr", "data-kind", "Harbour")
      .and("have.attr", "data-colors", "--c-kind-custom-1");
    cy.get("[data-testid=map-legend-kind]").should("contain", "Harbour");
    // Deleting the kind never rewrites the Place: it keeps its text, and the plain pin.
    cy.get("[data-testid=nav-settings]").click();
    cy.get("[data-testid=place-kind-row][data-kind=Harbour] [data-testid=place-kind-delete]").click();
    cy.get("[data-testid=place-kind-row]").should("not.exist");
    cy.runCommand("Go to Map");
    cy.contains("[data-testid=map-pin]", "Corinth").should("have.attr", "data-kind", "").find(".map-pin-dot").should("exist");
    cy.docByTitle("Corinth").then((d) => {
      cy.task<string>("file:read", `${Cypress.env("vault")}/${d.path}`).then((text) => {
        expect(text).to.match(/^kind: Harbour$/m);
      });
    });
  });

  it("fills the kind from the gazetteer in the New Place dialog", () => {
    cy.runCommand("Go to Map");
    cy.get("header").contains("button", "Place").click();
    cy.get("[data-testid=new-doc-form] [data-testid=gazetteer] input").type("Mount Tabor");
    cy.get("[data-testid=new-doc-form] [data-testid=gazetteer] li button").first().click();
    cy.get("[data-testid=new-doc-title]").should("have.value", "Mount Tabor");
    cy.get("[data-testid=new-doc-form] [data-testid=kind-picker]").should("have.attr", "data-kind", "mountain");
  });

  it("fills in kinds from the gazetteer only after naming every Place it will touch", () => {
    // A Place made by hand, with coordinates and no kind: the plain pin.
    cy.runCommand("Go to Map");
    cy.get("header").contains("button", "Place").click();
    cy.get("[data-testid=new-doc-title]").type("Tarsus");
    cy.get("[data-testid=new-doc-form] input[placeholder='31.7683']").type("36.9165");
    cy.get("[data-testid=new-doc-form] input[placeholder='35.2137']").type("34.8951");
    cy.get("[data-testid=new-doc-form]").contains("button", "Create").click();
    cy.hubTitle("Tarsus");
    // A new Place must not inherit the dialog's Source default (`kind: article`).
    cy.get("[data-testid=kind-picker]").should("have.attr", "data-kind", "");
    cy.runCommand("Go to Map");
    cy.contains("[data-testid=map-pin]", "Tarsus").should("have.attr", "data-kind", "");
    cy.get("[data-testid=map-fill-kinds]").should("contain", "1").click();
    cy.get("[role=alertdialog]").should("contain", "Tarsus — Settlement");
    cy.get("[data-testid=confirm-batch]").click();
    cy.contains("[data-testid=map-pin]", "Tarsus").should("have.attr", "data-kind", "settlement");
    cy.get("[data-testid=map-fill-kinds]").should("not.exist");
    cy.docByTitle("Tarsus").then((d) => {
      cy.task<string>("file:read", `${Cypress.env("vault")}/${d.path}`).then((text) => {
        expect(text).to.match(/^kind: settlement$/m);
      });
    });
  });
});
