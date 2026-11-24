// Capture boxes are the editor (spec #206): the shared CodeMirror editor with
// autocomplete, Passage decorations, editor Commands and Pictures, plus a
// box's own keys (Ctrl/⌘+Enter submits, Enter is a new line), no navigation
// on click, and a height that grows with the text to about 12 lines.
//
// Home's quick-capture box here (#223); the dialogs and the Source capture
// box add their cases with the same helpers.

const HOME = "[data-testid=home-quick]";
const vaultFile = (rel: string) => `${Cypress.env("vault")}/${rel}`;

/** The editable text of the box inside `box`. */
const content = (box: string) => cy.get(`${box} .cm-content`);

/**
 * Type at a person's pace: the autocomplete list opens after CodeMirror's
 * activation delay, so faster typing can hide a list that never narrowed.
 */
const typeSlowly = (box: string, text: string) => content(box).type(text, { delay: 150 });

/** Paste a picture the way a screenshot arrives: a File and no text. */
function pastePicture(selector: string) {
  cy.fixture("athens.png", null).then((bytes: Uint8Array) => {
    cy.window().then((win) => {
      const dt = new win.DataTransfer();
      dt.items.add(new win.File([bytes], "image.png", { type: "image/png" }));
      cy.get(selector).then(($el) => {
        $el[0].dispatchEvent(new win.ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      });
    });
  });
}

/** The stored text of every Note a capture made (titled with its moment). */
function capturedNotes() {
  return cy.query<{ title: string; path: string }[]>({ kind: "list", docType: "note" }).then((notes) => {
    const made = notes.filter((n) => /^\d{4}-\d{2}-\d{2} \d{2}\.\d{2}/.test(n.title));
    const texts: string[] = [];
    for (const n of made) cy.task<string>("file:read", vaultFile(n.path)).then((t) => texts.push(t));
    return cy.wrap(texts);
  });
}

/** Run `fn` with the raw markdown showing (Source mode), then go back to Live Preview. */
function inSource(box: string, fn: () => void) {
  content(box).type("{ctrl}e");
  fn();
  content(box).type("{ctrl}e");
}

describe("Writing boxes: Home's quick capture", () => {
  beforeEach(() => {
    cy.openApp();
    cy.get("h1").should("contain", "Home");
  });

  it("autocompletes links with [[ and Tags with #, Enter picking the completion", () => {
    content(HOME).click();
    typeSlowly(HOME, "See [[Geth");
    cy.get(".cm-tooltip-autocomplete").should("contain", "Gethsemane");
    content(HOME).type("{enter}");
    cy.get(".cm-tooltip-autocomplete").should("not.exist");
    cy.get(`${HOME} .cm-wikilink`).should("contain", "Gethsemane");
    typeSlowly(HOME, "{end} #pra");
    cy.get(".cm-tooltip-autocomplete").should("contain", "prayer");
    content(HOME).type("{enter}");
    cy.get(`${HOME} .cm-tag`).should("contain", "prayer");
    // Both Enters picked: still one line.
    cy.get(`${HOME} .cm-line`).should("have.length", 1);
  });

  it("decorates a Passage and shows its hover card", () => {
    content(HOME).click().type("Read Jas 1:2-4 today");
    cy.get(`${HOME} .cm-passage`).should("contain", "Jas 1:2-4").trigger("mouseover");
    cy.get("[data-testid=hover-card]").should("be.visible");
    // A card without a way out: leaving Home would lose the unsaved text.
    cy.get("[data-testid=hover-card]").should("not.contain", "Open page");
  });

  it("navigates nowhere when a link or Passage is clicked", () => {
    content(HOME).click().type("See [[Paul]] and Jas 1:2-4");
    cy.get("body").type("{esc}");
    cy.get(`${HOME} .cm-wikilink`).contains("Paul").click();
    cy.get(`${HOME} .cm-wikilink`).contains("Paul").click({ ctrlKey: true });
    cy.get(`${HOME} .cm-passage`).contains("Jas 1:2-4").click();
    cy.get("[data-testid=hover-card]").should("be.visible");
    cy.get(`${HOME} .cm-passage`).contains("Jas 1:2-4").click({ ctrlKey: true });
    cy.get("h1").should("contain", "Home");
    cy.get("[data-testid=hub-header]").should("not.exist");
    cy.get("[data-testid=panes]").should("not.have.attr", "data-count", "2");
    content(HOME).should("contain", "Jas 1:2-4");
  });

  it("bolds with Mod+B and runs palette Commands in the box", () => {
    content(HOME).click().type("bold me{ctrl}a{ctrl}b");
    content(HOME).type("{end}{enter}a task{ctrl}l");
    inSource(HOME, () => {
      content(HOME).should("contain", "**bold me**").and("contain", "- [ ] a task");
    });
    // From the palette: focus leaves the box for the palette and the Command still reaches it.
    content(HOME).click().type("{ctrl}{end}{enter}lean");
    content(HOME).type("{ctrl}a");
    cy.runCommand("Italic");
    inSource(HOME, () => {
      content(HOME).should("contain", "***bold me**");
    });
  });

  it("Ctrl/⌘+Enter creates the Note and stays on Home; Enter is a new line", () => {
    content(HOME).click().type("first line{enter}second line");
    cy.get(`${HOME} .cm-line`).should("have.length", 2);
    content(HOME).type("{ctrl}{enter}");
    cy.get(`${HOME} .cm-placeholder`).should("exist");
    cy.get("h1").should("contain", "Home");
    cy.wait(500);
    capturedNotes().should((texts) => {
      expect(texts.some((t) => t.includes("first line\nsecond line"))).to.eq(true);
    });
  });

  it("keeps a pasted picture in Attachments, named by the time of the paste, and draws it", () => {
    content(HOME).click();
    pastePicture(`${HOME} .cm-content`);
    cy.get(`${HOME} [data-testid=picture][data-state=shown]`).should("exist");
    // Untitled, so named by the moment (ADR 0019); `a35094` is the fixture's hash.
    content(HOME)
      .invoke("text")
      .then((text) => {
        const m = /Attachments\/(\d{4}-\d{2}-\d{2} \d{6} a35094\.png)/.exec(text);
        expect(m, "time-named Picture").to.not.be.null;
        cy.task<boolean>("file:exists", vaultFile(`Attachments/${m![1]}`)).should("eq", true);
      });
  });

  it("takes a dropped picture too", () => {
    content(HOME).selectFile("cypress/fixtures/athens.png", { action: "drag-drop" });
    cy.get(`${HOME} [data-testid=picture][data-state=shown]`).should("exist");
  });

  it("starts 3 lines tall, grows to about 12, then scrolls inside", () => {
    const scroller = `${HOME} .cm-scroller`;
    content(HOME).click().type("x");
    cy.get(`${HOME} .cm-line`)
      .first()
      .invoke("outerHeight")
      .then((lh) => {
        const line = lh as number;
        cy.get(scroller).invoke("outerHeight").should("be.closeTo", 3 * line + 16, 4);
        content(HOME).type("{enter}".repeat(19));
        cy.get(scroller).invoke("outerHeight").should("be.closeTo", 12 * line + 16, 8);
        cy.get(scroller).should(($s) => expect($s[0].scrollHeight).to.be.greaterThan($s[0].clientHeight));
      });
  });

  // Mod+B never reaches a Writing page open beside the box.
  it("leaves the Writing page in the other Pane alone", () => {
    const pane = (i: 0 | 1) => `[data-testid=pane][data-pane=${i}]`;
    cy.openDoc("Endurance in trials");
    cy.get(`${pane(0)} .cm-content [data-link="Undeserved kindness in Romans"]`).first().click({ ctrlKey: true });
    cy.get("[data-testid=panes]").should("have.attr", "data-count", "2");
    cy.get(`${pane(1)} [data-testid=doc-title]`).should("have.value", "Undeserved kindness in Romans");
    cy.get(`${pane(0)} [data-testid=doc-back]`).click();
    cy.get(`${pane(0)} ${HOME}`).should("exist");
    cy.get(`${pane(1)} .cm-content`)
      .invoke("text")
      .then((before) => {
        content(`${pane(0)} ${HOME}`).click().type("bold me{ctrl}a{ctrl}b");
        cy.runCommand("Toggle checkbox");
        inSource(`${pane(0)} ${HOME}`, () => {
          content(`${pane(0)} ${HOME}`).should("contain", "- [ ] **bold me**");
        });
        cy.get(`${pane(1)} .cm-content`).invoke("text").should("equal", before);
      });
  });
});
