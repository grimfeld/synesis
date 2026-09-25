// Walks the Map & Journeys Tutorial (docs/tutorials/map.en.md) step by step
// on the demo vault, so a change to the Map that outdates the Tutorial fails
// here (PLAN §25.13). Tiles are blocked offline, so the walk asserts on
// markers, labels and routes, never on the map background.
describe("Tutorial: Map & Journeys", () => {
  beforeEach(() => cy.openApp());

  const markers = () => cy.get("[data-testid=map] .leaflet-interactive");

  it("can be followed to the end", () => {
    // Opened from a Place's Hub, which lists it, the way a user who is
    // looking at a Place would come to it.
    cy.openDoc("Corinth");
    cy.hubTitle("Corinth");
    cy.openTutorial("map");

    // 1. Every Place with coordinates is a labelled marker; a click opens its Hub.
    cy.tutorialStep(0);
    cy.tutorialCommand("nav.map");
    cy.query<{ title: string }[]>({ kind: "places" }).then((places) => {
      markers().should("have.length", places.length);
      cy.get("[data-testid=map] .map-label").should("have.length", places.length);
      // Markers are added in the order `places()` returns them, as in map.cy.ts.
      const i = places.findIndex((p) => p.title === "Corinth");
      expect(i, "Corinth among the plotted Places").to.be.at.least(0);
      markers().eq(i).click();
    });
    cy.hubTitle("Corinth");
    cy.tutorialCommand("nav.map");
    cy.get("[data-testid=map]").should("exist");
    cy.tutorialNext();

    // 2. Search and the filter popover narrow the Places; Clear filters restores.
    cy.tutorialStep(1);
    markers().its("length").then((all) => {
      cy.get("[data-testid=map-search]").type("corin");
      markers().should("have.length", 1);
      cy.get("[data-testid=map] .map-label").should("contain", "Corinth");
      cy.get("[data-testid=map-filter]").should("have.attr", "data-active", "1").click();
      cy.get("[data-testid=map-mentioned-only]").check();
      cy.get("[data-testid=map-filter]").should("have.attr", "data-active", "2");
      cy.get("[data-testid=map-filter-clear]").click();
      cy.get("[data-testid=map-filter]").should("have.attr", "data-active", "0");
      cy.get("body").type("{esc}");
      markers().should("have.length", all);
    });
    cy.tutorialNext();

    // 3. A Journey chip draws its numbered route; Antioch carries both visits.
    cy.tutorialStep(2);
    cy.get("[data-testid=map] .map-route").should("not.exist");
    cy.get("[data-testid=map-filter]").click();
    cy.contains("button", "Paul's second missionary journey").click();
    cy.get("body").type("{esc}");
    cy.get("[data-testid=map] .map-route").should("have.length.greaterThan", 0);
    cy.get("[data-testid=map] .map-arrow").should("have.length.greaterThan", 0);
    cy.get("[data-testid=map] .map-label").contains("Antioch").should("contain", "1").and("contain", "6");
    // Turn it off again, so the next steps see ordinary Places only.
    cy.get("[data-testid=map-filter]").click();
    cy.contains("button", "Paul's second missionary journey").click();
    cy.get("body").type("{esc}");
    cy.get("[data-testid=map] .map-route").should("not.exist");
    cy.tutorialNext();

    // 4. Troas has no coordinates: Set location from the bundled list puts it on the Map.
    cy.tutorialStep(3);
    cy.get("[data-testid=map] .map-label").should("not.contain", "Troas");
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
    cy.get("[data-testid=map] .map-label").should("contain", "Troas");
    cy.tutorialNext();

    // 5. Do it once: a new Place looked up in the bundled list lands on the Map.
    cy.tutorialStep(4);
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
    cy.get("[data-testid=map] .map-label").should("contain", "Philippi");
    cy.docByTitle("Paul's first journey").then((d) => {
      cy.task<string>("file:read", `${Cypress.env("vault")}/${d.path}`).then((text) => {
        expect(text).to.contain('places: ["[[Antioch]]", "[[Philippi]]", "[[Corinth]]"]');
      });
    });
    cy.tutorialDone();
  });
});
