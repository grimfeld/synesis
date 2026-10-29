// Two Panes side by side in one Window (spec #35, PLAN §29). Cypress runs at
// 1400x900, which fits two Panes beside the sidebar; the side panel, when
// open, takes its own column beside both.
describe("Panes", () => {
  beforeEach(() => {
    // The layout is kept per Device: start every test on one Pane.
    cy.visit("/", {
      onBeforeLoad: (w) => {
        for (const k of Object.keys(w.localStorage)) if (k.startsWith("synesis.panes:")) w.localStorage.removeItem(k);
      },
    });
    cy.get("[data-testid=home-recent]", { timeout: 15000 }).should("exist");
  });

  const pane = (i: 0 | 1) => `[data-testid=pane][data-pane=${i}]`;

  /** "Endurance in trials" on the left, "Undeserved kindness in Romans" on the right. */
  const openTwo = () => {
    cy.openDoc("Endurance in trials");
    cy.get(`${pane(0)} .cm-content [data-link="Undeserved kindness in Romans"]`).first().click({ ctrlKey: true });
    cy.get("[data-testid=panes]").should("have.attr", "data-count", "2");
    cy.get(`${pane(0)} [data-testid=doc-title]`).should("have.value", "Endurance in trials");
    cy.get(`${pane(1)} [data-testid=doc-title]`).should("have.value", "Undeserved kindness in Romans");
  };

  it("opens a Cmd/Ctrl-clicked link in the other Pane, and a plain click in the same one", () => {
    openTwo();
    cy.get(pane(1)).should("have.attr", "data-last-used", "true");
    cy.get(`${pane(1)} [data-testid=pane-mark]`).should("exist");
    cy.get(`${pane(0)} [data-testid=pane-mark]`).should("not.exist");
    // A plain click navigates within its own Pane.
    cy.get(`${pane(1)} .cm-content [data-link=Paul]`).first().click();
    cy.get(pane(1)).within(() => cy.hubTitle("Paul"));
    cy.get(`${pane(0)} [data-testid=doc-title]`).should("have.value", "Endurance in trials");
  });

  it("opens the page in the other Pane from the palette and the header", () => {
    cy.openDoc("Endurance in trials");
    cy.runCommand("Open in other Pane");
    cy.get("[data-testid=panes]").should("have.attr", "data-count", "2");
    cy.get(`${pane(1)} [data-testid=doc-title]`).should("have.value", "Endurance in trials");
    cy.runCommand("Close Pane");
    cy.get("[data-testid=panes]").should("have.attr", "data-count", "1");
    cy.get(`${pane(0)} [data-testid=pane-open-other]`).click();
    cy.get("[data-testid=panes]").should("have.attr", "data-count", "2");
    // The palette opens documents in the last-used Pane.
    cy.openDoc("Psalm 23 reflections");
    cy.get(`${pane(1)} [data-testid=doc-title]`).should("have.value", "Psalm 23 reflections");
    cy.get(`${pane(0)} [data-testid=doc-title]`).should("have.value", "Endurance in trials");
  });

  it("goes Back in the last-used Pane only", () => {
    openTwo();
    cy.get(`${pane(1)} .cm-content [data-link=Paul]`).first().click();
    cy.get(pane(1)).within(() => cy.hubTitle("Paul"));
    // The left Pane has nowhere earlier than Home to go: Back from the
    // palette acts on the right one, which was used last.
    cy.runCommand("Back");
    cy.get(`${pane(1)} [data-testid=doc-title]`).should("have.value", "Undeserved kindness in Romans");
    cy.get(`${pane(0)} [data-testid=doc-title]`).should("have.value", "Endurance in trials");
    // Used last now, the left Pane goes back to Home.
    cy.get(`${pane(0)} .cm-content`).click();
    cy.get(pane(0)).should("have.attr", "data-last-used", "true");
    cy.runCommand("Back");
    cy.get(`${pane(0)} [data-testid=home-recent]`).should("exist");
    cy.get(`${pane(1)} [data-testid=doc-title]`).should("have.value", "Undeserved kindness in Romans");
    // The right Pane has nothing left behind it; its own Back button says so.
    cy.get(`${pane(1)} [data-testid=doc-back]`).should("be.disabled");
  });

  it("shows the side panel for the last-used Pane, beside both", () => {
    openTwo();
    cy.get("[data-testid=right-panel]").should("have.length", 1).and("be.visible");
    cy.docByTitle("Undeserved kindness in Romans").then((d) => {
      cy.get("[data-testid=right-panel]").should("have.attr", "data-doc", d.id);
    });
    cy.get(`${pane(0)} .cm-content`).click();
    cy.docByTitle("Endurance in trials").then((d) => {
      cy.get("[data-testid=right-panel]").should("have.attr", "data-doc", d.id);
    });
    // The panel stands right of both Panes, not between them.
    cy.get(pane(1)).then(($p) => {
      cy.get("[data-testid=right-panel]").should(($r) => {
        expect($r[0].getBoundingClientRect().left).to.be.at.least($p[0].getBoundingClientRect().right - 1);
      });
    });
  });

  it("closes and swaps Panes", () => {
    openTwo();
    cy.runCommand("Swap Panes");
    cy.get(`${pane(0)} [data-testid=doc-title]`).should("have.value", "Undeserved kindness in Romans");
    cy.get(`${pane(1)} [data-testid=doc-title]`).should("have.value", "Endurance in trials");
    cy.get(pane(0)).should("have.attr", "data-last-used", "true");
    cy.get(`${pane(0)} [data-testid=pane-close]`).click();
    cy.get("[data-testid=panes]").should("have.attr", "data-count", "1");
    cy.get(`${pane(0)} [data-testid=doc-title]`).should("have.value", "Endurance in trials");
    cy.get("[data-testid=pane-close]").should("not.exist");
  });

  it("resizes the Panes with the divider, never below the minimum", () => {
    openTwo();
    cy.get("[data-testid=pane-divider]").should("have.attr", "aria-valuenow", "50").focus();
    for (let i = 0; i < 10; i++) cy.get("[data-testid=pane-divider]").type("{leftarrow}");
    cy.get(pane(0)).should(($p) => expect($p[0].getBoundingClientRect().width).to.be.at.least(319));
    cy.get(pane(1)).should(($p) => expect($p[0].getBoundingClientRect().width).to.be.greaterThan(320));
  });

  it("collapses to the last-used Pane at phone width, and keeps the other", () => {
    openTwo();
    cy.get(`${pane(0)} .cm-content`).click();
    cy.viewport(390, 844);
    cy.get("[data-testid=panes]").should("have.attr", "data-count", "1");
    cy.get(`${pane(0)} [data-testid=doc-title]`).should("have.value", "Endurance in trials");
    cy.get(pane(1)).should("not.exist");
    cy.get("[data-testid=pane-divider]").should("not.exist");
    // Cmd/Ctrl-click opens as a plain click on a phone.
    cy.get(`${pane(0)} .cm-content [data-link=Paul]`).first().click({ ctrlKey: true });
    cy.get(pane(0)).within(() => cy.hubTitle("Paul"));
    cy.get("[data-testid=panes]").should("have.attr", "data-count", "1");
    cy.viewport(1400, 900);
    cy.get("[data-testid=panes]").should("have.attr", "data-count", "2");
    cy.get(`${pane(1)} [data-testid=doc-title]`).should("have.value", "Undeserved kindness in Romans");
  });

  it("shows typing in one Pane at once in the other on the same Note, and saves both", () => {
    cy.openDoc("Endurance in trials");
    cy.runCommand("Open in other Pane");
    cy.get("[data-testid=panes]").should("have.attr", "data-count", "2");
    cy.get(`${pane(1)} [data-testid=doc-title]`).should("have.value", "Endurance in trials");
    cy.get(`${pane(0)} .cm-content`).click().type("{ctrl}{end}").type("{enter}Typed on the left");
    cy.get(`${pane(1)} .cm-content`).should("contain.text", "Typed on the left");
    // Typing on the right reaches the left without taking back the left's words.
    cy.get(`${pane(1)} .cm-content`).click().type("{ctrl}{end}").type(", then the right");
    cy.get(`${pane(0)} .cm-content`).should("contain.text", "Typed on the left, then the right");
    // Neither Pane's save overwrites the other's typing.
    cy.wait(1000);
    cy.get(`${pane(1)} [data-testid=save-status]`).should("have.attr", "data-status", "saved");
    cy.docByTitle("Endurance in trials").then((d) => {
      cy.bridge<{ text: string }>("get_document", { id: d.id }).its("text").should("contain", "Typed on the left, then the right");
    });
    // Closing one Pane keeps the other on the same text.
    cy.runCommand("Close Pane");
    cy.get(`${pane(0)} .cm-content`).should("contain.text", "Typed on the left, then the right");
  });

  it("restores two Panes when the app reopens, and one Pane opens on Home", () => {
    openTwo();
    cy.reload();
    cy.get("[data-testid=panes]", { timeout: 15000 }).should("have.attr", "data-count", "2");
    cy.get(`${pane(0)} [data-testid=doc-title]`).should("have.value", "Endurance in trials");
    cy.get(`${pane(1)} [data-testid=doc-title]`).should("have.value", "Undeserved kindness in Romans");
    cy.get(pane(1)).should("have.attr", "data-last-used", "true");
    cy.runCommand("Close Pane");
    cy.reload();
    cy.get("[data-testid=home-recent]", { timeout: 15000 }).should("exist");
    cy.get("[data-testid=panes]").should("have.attr", "data-count", "1");
  });
});
