// Walks the Timeline Tutorial (docs/tutorials/timeline.en.md) step by step on
// the demo vault, so a change to the Timeline that outdates the Tutorial fails
// here (PLAN §24.13).
describe("Tutorial: Timeline", () => {
  // Kinds and the cull persist in settings, so start and end unfiltered, as
  // timeline.cy.ts does.
  beforeEach(() => {
    cy.bridge("set_timeline_filters", { hiddenTypes: [], inView: true });
    cy.openApp();
  });
  afterEach(() => cy.bridge("set_timeline_filters", { hiddenTypes: [], inView: true }));

  const span = ($svg: JQuery) => Number($svg.attr("data-to")) - Number($svg.attr("data-from"));

  it("can be followed to the end", () => {
    cy.get("[data-testid=nav-timeline]").click();
    cy.get("h1").should("contain", "Timeline");
    cy.openTutorial("timeline");

    // 1. The Events Lane on top, then a Lane per dated Subject.
    cy.tutorialStep(0);
    cy.tutorialCommand("nav.timeline");
    cy.get("[data-testid=tl-lane]").first().should("have.attr", "data-lane", "events");
    cy.get("[data-testid=tl-lane][data-type=character]").should("have.length.greaterThan", 1);
    cy.tutorialNext();

    // 2. Zoom in and fit back; crowded Dates form Clusters at fit zoom.
    cy.tutorialStep(1);
    cy.get("[data-testid=tl-lane][data-lane=events] [data-testid=tl-cluster]").should("exist");
    cy.get("[data-testid=timeline] svg").then(($svg) => {
      const all = span($svg);
      cy.get("button[aria-label='Zoom in']").click();
      cy.get("[data-testid=timeline] svg").should(($z) => expect(span($z)).to.be.lessThan(all));
      cy.get("button[aria-label='Fit all']").click();
      cy.get("[data-testid=timeline] svg").should(($z) => expect(span($z)).to.equal(all));
    });
    cy.tutorialNext();

    // 3. Search narrows the Lanes; Clear filters restores them.
    cy.tutorialStep(2);
    cy.get("[data-testid=tl-lane]").its("length").then((all) => {
      cy.get("[data-testid=tl-search]").type("Paul");
      cy.get("[data-testid=tl-lane][data-type=character]").should("have.length", 1).and("contain", "Paul");
      cy.get("[data-testid=tl-filter]").should("have.attr", "data-active", "1").click();
      cy.get("[data-testid=tl-in-view]").should("be.checked");
      cy.get("[data-testid=tl-filter-clear]").click();
      cy.get("[data-testid=tl-lane]").should("have.length", all);
    });
    cy.get("body").type("{esc}");
    cy.tutorialNext();

    // 4. A mark opens its Hub, which shows its Lane in miniature.
    cy.tutorialStep(3);
    cy.get("[data-testid=tl-search]").type("Death of Jesus");
    cy.docByTitle("Death of Jesus").then((ev) => {
      cy.get(`[data-testid=tl-lane][data-lane=events] [data-testid=tl-mark][data-doc=${ev.id}]`).click({ force: true });
    });
    cy.hubTitle("Death of Jesus");
    cy.get("[data-testid=hub-minitimeline]").should("be.visible");
    cy.get("[data-testid=tl-open-full]").click();
    cy.get("h1").should("contain", "Timeline");
    cy.get("[data-testid=tl-search]").should("have.value", "Death of Jesus").clear();
    cy.tutorialNext();

    // 5. Do it once: a new Event with a Start Date lands on the Events Lane.
    cy.tutorialStep(4);
    cy.tutorialCommand("create.event");
    cy.get("[data-testid=new-doc-form]").should("contain", "Event");
    cy.get("[data-testid=new-doc-form] input").first().type("Paul shipwrecked on Malta");
    cy.get("[data-testid=new-start]").type("c. 58 CE");
    cy.get("[data-testid=new-doc-form]").contains("button", "Create").click();
    cy.hubTitle("Paul shipwrecked on Malta");
    cy.get("[data-testid=nav-timeline]").click();
    // Open in Timeline left the range on 33 CE; fit back to see everything.
    cy.get("button[aria-label='Fit all']").click();
    cy.get("[data-testid=tl-search]").type("shipwrecked");
    cy.docByTitle("Paul shipwrecked on Malta").then((ev) => {
      expect(ev.path).to.match(/^Events\//);
      cy.get(`[data-testid=tl-lane][data-lane=events] [data-testid=tl-mark][data-doc=${ev.id}]`).should("exist");
    });
    cy.get("[data-testid=tl-search]").clear();
    cy.tutorialDone();
  });
});
