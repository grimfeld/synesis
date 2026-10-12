// Walks the Map & Journeys Tutorial (docs/tutorials/map.en.md) step by step
// on the demo vault, so a change to the Map that outdates the Tutorial fails
// here (PLAN §25.13). The walk asserts on pins, names and routes, never on
// the atlas under them.
describe("Tutorial: Map & Journeys", () => {
  beforeEach(() => cy.openApp());

  const markers = () => cy.get("[data-testid=map] [data-testid=map-pin]");
  const pin = (title: string) => cy.contains("[data-testid=map-pin]", title);

  it("can be followed to the end", () => {
    // Opened from a Place's Hub, which lists it, the way a user who is
    // looking at a Place would come to it.
    cy.openDoc("Corinth");
    cy.hubTitle("Corinth");
    cy.openTutorial("map");

    // 1. Every Place with coordinates is a pin shaped by its kind; a region is
    //    a name alone; the legend lists the kinds; a click opens the Hub.
    cy.tutorialStep(0);
    cy.tutorialCommand("nav.map");
    cy.query<{ title: string }[]>({ kind: "places" }).then((places) => {
      markers().should("have.length", places.length);
      cy.get("[data-testid=map] .map-name").should("have.length", places.length);
    });
    pin("Mount Sinai").should("have.attr", "data-kind", "mountain");
    pin("Egypt").should("have.class", "no-pin");
    cy.get("[data-testid=map-legend-kind]").should("contain", "Mountain");
    pin("Corinth").find(".map-pin").click({ force: true });
    cy.hubTitle("Corinth");
    cy.tutorialCommand("nav.map");
    cy.get("[data-testid=map]").should("exist");
    cy.tutorialNext();

    // 2. Search and the filter popover narrow the Places; Clear filters restores.
    cy.tutorialStep(1);
    markers().its("length").then((all) => {
      cy.get("[data-testid=map-search]").type("corin");
      markers().should("have.length", 1);
      cy.get("[data-testid=map] .map-name").should("contain", "Corinth");
      cy.get("[data-testid=map-filter]").should("have.attr", "data-active", "1").click();
      cy.get("[data-testid=map-mentioned-only]").check();
      cy.get("[data-testid=map-filter]").should("have.attr", "data-active", "2");
      cy.get("[data-testid=map-filter-clear]").click();
      cy.get("[data-testid=map-filter]").should("have.attr", "data-active", "0");
      cy.get("body").type("{esc}");
      markers().should("have.length", all);
    });
    cy.tutorialNext();

    // 3. Colour by Book: two Books compared, Jerusalem split between them,
    //    the rest grey; the legend's ✕ drops one.
    cy.tutorialStep(2);
    cy.get("[data-testid=map-filter]").click();
    cy.get("[data-testid=map-color-by-book]").click();
    cy.get("[data-testid=map-color-values] button").contains("Exodus").click();
    cy.get("[data-testid=map-color-values] button").contains("1 Kings").click();
    cy.get("body").type("{esc}");
    pin("Jerusalem").find(".map-pin-disc path").should("have.length", 2);
    pin("Rome").should("have.class", "is-muted");
    cy.get("[data-testid=map-legend-uncolor]").first().click();
    cy.get("[data-testid=map-legend-color]").should("have.length", 1);
    // Back to Kind, so the steps after see pins in their kinds' colours.
    cy.get("[data-testid=map-filter]").click();
    cy.get("[data-testid=map-color-by-kind]").click();
    cy.get("body").type("{esc}");
    cy.tutorialNext();

    // 4. A Journey chip draws its numbered route; Antioch carries both visits.
    cy.tutorialStep(3);
    cy.get("[data-testid=map] .map-route").should("not.exist");
    cy.get("[data-testid=map-filter]").click();
    cy.get("[data-testid=map-filter-journeys] button").contains("Paul's second missionary journey").click();
    cy.get("body").type("{esc}");
    cy.get("[data-testid=map] .map-route").should("have.length.greaterThan", 0);
    cy.get("[data-testid=map] .map-arrow").should("have.length.greaterThan", 0);
    pin("Antioch").find("[data-testid=map-stop-number]").should("contain", "1").and("contain", "6");
    // Turn it off again, so the next steps see ordinary Places only.
    cy.get("[data-testid=map-filter]").click();
    cy.get("[data-testid=map-filter-journeys] button").contains("Paul's second missionary journey").click();
    cy.get("body").type("{esc}");
    cy.get("[data-testid=map] .map-route").should("not.exist");
    cy.tutorialNext();

    // 5. A Place's kind is picked on its Hub, or made there; the gazetteer fills
    //    in the rest, after naming what it would change.
    cy.tutorialStep(4);
    cy.openDoc("Patmos");
    cy.hubTitle("Patmos");
    cy.get("[data-testid=kind-picker]").should("have.attr", "data-kind", "region").click();
    cy.get("[data-testid=kind-new]").click();
    cy.get("[data-testid=kind-new-name]").type("Island");
    cy.get("[data-testid=kind-icon][data-icon=sailboat]").click();
    cy.get("[data-testid=kind-new-save]").click();
    cy.get("[data-testid=kind-picker]").should("have.attr", "data-kind", "Island");
    cy.runCommand("Go to Map");
    pin("Patmos").should("have.attr", "data-kind", "Island");
    cy.get("[data-testid=map-legend-kind]").should("contain", "Island");
    // Every demo Place already has a kind, so the gazetteer has nothing to add.
    cy.tutorialCommand("map.fill_kinds");
    cy.contains("Every Place the gazetteer knows already has a kind.").should("exist");
    cy.tutorialNext();

    // 6. Troas has no coordinates: Set location from the bundled list puts it on the Map.
    cy.tutorialStep(5);
    cy.get("[data-testid=map] .map-name").should("not.contain", "Troas");
    cy.openDoc("Troas");
    cy.hubTitle("Troas");
    cy.get("button[aria-label='Set location']").click();
    cy.get("[data-testid=set-location]").should("be.visible");
    cy.get("[data-testid=gazetteer] input").type("Troas");
    cy.get("[data-testid=gazetteer] button").contains(/^Troas$/).click();
    cy.contains("button", "Use this location").click();
    cy.get("[data-testid=set-location]").should("not.exist");
    cy.get("[data-testid=property-lat] input").should("have.value", "39.7519");
    cy.runCommand("Go to Map");
    cy.get("[data-testid=map] .map-name").should("contain", "Troas");
    cy.tutorialNext();

    // 7. Do it once: a Journey through a Place the gazetteer makes, kind and all.
    cy.tutorialStep(6);
    cy.tutorialCommand("create.journey");
    cy.get("[data-testid=new-doc-title]").type("Paul's first journey");
    cy.get("[data-testid=new-doc-form]").contains("button", "Create").click();
    cy.hubTitle("Paul's first journey");
    cy.get("[data-testid=journey-add-stop]").click();
    // Places the Vault holds come first; a Bible place is created on the pick.
    const add = (query: string, kind: "place" | "gazetteer", name: string) => {
      cy.get("[data-testid=journey-stop-input]").type(query);
      cy.get(`[data-testid=journey-stop-option][data-kind=${kind}]`).contains(name).click();
      cy.get("[data-testid=journey-stop-input]").should("have.value", "");
    };
    add("antioch", "place", "Antioch");
    add("corinth", "place", "Corinth");
    add("philippi", "gazetteer", "Philippi");
    // Philippi came before Corinth: fix the order with the arrows.
    cy.get("[data-testid=journey-stop]").eq(2).find("button[aria-label='Move earlier']").click();
    cy.get("[data-testid=journey-stop]").then((rows) => {
      expect([...rows].map((r) => r.innerText.split("\n")[1])).to.deep.equal(["Antioch", "Philippi", "Corinth"]);
    });
    cy.get("[data-testid=journey-stop][data-status=ok]").should("have.length", 3);
    cy.get("[data-testid=journey-stop-close]").click();
    cy.get("[data-testid=journey-show-on-map]").click();
    cy.get("[data-testid=map] .map-route").should("have.length.greaterThan", 0);
    cy.get("[data-testid=map] .map-name").should("contain", "Philippi");
    pin("Philippi").should("have.attr", "data-kind", "settlement");
    cy.docByTitle("Paul's first journey").then((d) => {
      cy.task<string>("file:read", `${Cypress.env("vault")}/${d.path}`).then((text) => {
        expect(text).to.contain('places: ["[[Antioch]]", "[[Philippi]]", "[[Corinth]]"]');
      });
    });
    cy.tutorialDone();
  });
});
