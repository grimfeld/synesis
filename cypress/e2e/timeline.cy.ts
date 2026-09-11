// Timeline view: lanes by Subject, Events lane on top, zoom and pan.
describe("Timeline", () => {
  beforeEach(() => cy.openApp());

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
    cy.get(
      "[data-testid=tl-lane][data-lane=events] [data-testid=tl-mark]",
    ).should("have.length", 19);
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
        cy.get(
          `[data-testid=tl-lane][data-lane=${david.id}] [data-testid=tl-mark][data-doc=${ev.id}]`,
        ).should("not.exist");
      });
    });
    // Approximate Dates are drawn faded.
    cy.docByTitle("David anointed king").then((ev) => {
      cy.get(
        `[data-testid=tl-lane][data-lane=events] [data-testid=tl-mark][data-doc=${ev.id}]`,
      ).should("have.attr", "data-approx", "true");
    });
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
});
