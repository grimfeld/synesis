// Capture boxes are the editor (spec #206): the shared CodeMirror editor with
// autocomplete, Passage decorations, editor Commands and Pictures, plus a
// box's own keys (Ctrl/⌘+Enter submits, Enter is a new line), no navigation
// on click, and a height that grows with the text to about 12 lines.
//
// Home's quick-capture box (#223), the Quick capture dialog and the New
// document dialog's Clipping text (#224), and the Source capture box (#225),
// with the same helpers.

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

/**
 * The box's textbox (CodeMirror's content) has an accessible name: its own
 * `aria-label`, or a visible label it points to with `aria-labelledby`.
 */
function hasAccessibleName(box: string) {
  content(box)
    .should("have.attr", "role", "textbox")
    .then(($c) => {
      const label = $c.attr("aria-label")?.trim();
      const by = $c.attr("aria-labelledby");
      if (label) return;
      expect(by, "aria-label or aria-labelledby").to.be.a("string").and.not.be.empty;
      cy.document().then((doc) => {
        const names = by!.split(/\s+/).map((id) => doc.getElementById(id)?.textContent?.trim() ?? "");
        expect(names.join(" ").trim(), "the labelling element's text").to.not.be.empty;
      });
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

  it("has an accessible name", () => {
    hasAccessibleName(HOME);
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

// The capture box on a Source's page (#225), in Clipping and Note mode: the
// same editor, Ctrl/⌘+Enter keeping the focus for the next capture, a
// Clipping quoted on every line, and Pictures named after the Source.
describe("Writing boxes: the Source capture box", () => {
  const SOURCE = "Keep Enduring with Joy";
  const BOX = "[data-testid=capture-text]";
  const pane = (i: 0 | 1) => `[data-testid=pane][data-pane=${i}]`;
  const focusedInBox = () => cy.focused().should("have.class", "cm-content").closest(BOX).should("exist");
  /** The stored text of the one Clipping of this Source with Locator `locator`. */
  const clippingText = (locator: string) =>
    cy.query<{ path: string; type: string }[]>({ kind: "list", docType: null }).then((docs) => {
      const kept = docs.filter((d) => d.type === "clipping" && d.path.includes(locator));
      expect(kept, `the Clipping at ${locator}`).to.have.length(1);
      return cy.task<string>("file:read", vaultFile(kept[0].path));
    });

  beforeEach(() => {
    cy.openApp();
    cy.openDoc(SOURCE);
    cy.get("[data-testid=hub-capture]").should("exist");
  });

  it("has an accessible name in both modes", () => {
    for (const mode of ["clipping", "note"] as const) {
      cy.get(`[data-testid=capture-as-${mode}]`).click();
      hasAccessibleName(BOX);
    }
  });

  for (const mode of ["clipping", "note"] as const) {
    it(`autocompletes links and Tags and decorates a Passage (${mode})`, () => {
      cy.get(`[data-testid=capture-as-${mode}]`).click();
      content(BOX).click();
      typeSlowly(BOX, "See [[Geth");
      cy.get(".cm-tooltip-autocomplete").should("contain", "Gethsemane");
      content(BOX).type("{enter}");
      cy.get(`${BOX} .cm-wikilink`).should("contain", "Gethsemane");
      typeSlowly(BOX, "{end} #pra");
      cy.get(".cm-tooltip-autocomplete").should("contain", "prayer");
      content(BOX).type("{enter}");
      cy.get(`${BOX} .cm-tag`).should("contain", "prayer");
      cy.get(`${BOX} .cm-line`).should("have.length", 1);
      content(BOX).type("{end} and Jas 1:2-4");
      cy.get(`${BOX} .cm-passage`).should("contain", "Jas 1:2-4").trigger("mouseover");
      cy.get("[data-testid=hover-card]").should("be.visible").and("not.contain", "Open page");
    });
  }

  it("navigates nowhere when a link or Passage is clicked", () => {
    content(BOX).click().type("See [[Paul]] and Jas 1:2-4");
    cy.get("body").type("{esc}");
    cy.get(`${BOX} .cm-wikilink`).contains("Paul").click({ ctrlKey: true });
    cy.get(`${BOX} .cm-passage`).contains("Jas 1:2-4").click({ ctrlKey: true });
    cy.hubTitle(SOURCE);
    cy.get("[data-testid=panes]").should("not.have.attr", "data-count", "2");
    content(BOX).should("contain", "Jas 1:2-4");
  });

  it("bolds with Mod+B and runs palette Commands in the box", () => {
    content(BOX).click().type("bold me{ctrl}a{ctrl}b");
    content(BOX).type("{end}{enter}a task{ctrl}l");
    content(BOX).type("{ctrl}a");
    cy.runCommand("Italic");
    inSource(BOX, () => {
      content(BOX).should("contain", "***bold me**").and("contain", "- [ ] a task");
    });
  });

  it("stores a Clipping quoted on every line, markdown kept inside the quote", () => {
    content(BOX).click().type("*Kept* in [[Paul]] today{enter}second **line**");
    cy.get(`${BOX} .cm-line`).should("have.length", 2);
    cy.get("[data-testid=capture-locator]").type("par. 98");
    content(BOX).type("{ctrl}{enter}");
    // Emptied for the next one, which the focus is already in.
    cy.get(`${BOX} .cm-placeholder`).should("exist");
    focusedInBox();
    cy.hubTitle(SOURCE);
    cy.get("[data-testid=hub-clippings]").should("contain", "Kept");
    clippingText("par. 98").should("contain", "> *Kept* in [[Paul]] today\n> second **line**\n");
  });

  it("Ctrl/⌘+Enter keeps a Note citing the Source and keeps the focus, empty", () => {
    cy.get("[data-testid=capture-as-note]").click();
    content(BOX).click().type("A Note in the box{enter}on two lines");
    cy.get("[data-testid=capture-title]").type("Box note");
    content(BOX).type("{ctrl}{enter}");
    cy.get(`${BOX} .cm-placeholder`).should("exist");
    focusedInBox();
    cy.get("[data-testid=hub-trail]").should("contain", "Box note");
    cy.docByTitle("Box note").then((d) =>
      cy.task<string>("file:read", vaultFile(d.path)).then((text) => {
        expect(text).to.contain("A Note in the box\non two lines");
        expect(text).to.contain(`source: "[[${SOURCE}]]"`);
      }),
    );
    // And the next one goes straight in.
    cy.focused().type("Another{ctrl}{enter}");
    cy.get(`${BOX} .cm-placeholder`).should("exist");
  });

  it("names a pasted picture after the Source, in both modes", () => {
    for (const mode of ["clipping", "note"] as const) {
      cy.get(`[data-testid=capture-as-${mode}]`).click();
      content(BOX).click();
      pastePicture(`${BOX} .cm-content`);
      cy.get(`${BOX} [data-testid=picture][data-state=shown]`).should("exist");
      // `a35094` is the fixture's hash (ADR 0019).
      inSource(BOX, () => {
        content(BOX).should("contain", "![[Attachments/keep enduring with joy a35094.png]]");
      });
      cy.task<boolean>("file:exists", vaultFile("Attachments/keep enduring with joy a35094.png")).should("eq", true);
      content(BOX).type("{ctrl}a{backspace}");
    }
  });

  it("starts 3 lines tall and grows to about 12", () => {
    const scroller = `${BOX} .cm-scroller`;
    content(BOX).click().type("x");
    cy.get(`${BOX} .cm-line`)
      .first()
      .invoke("outerHeight")
      .then((lh) => {
        const line = lh as number;
        cy.get(scroller).invoke("outerHeight").should("be.closeTo", 3 * line + 16, 4);
        content(BOX).type("{enter}".repeat(19));
        cy.get(scroller).invoke("outerHeight").should("be.closeTo", 12 * line + 16, 8);
      });
  });

  it("is not locked by Reading mode", () => {
    // Reading mode is the Device's; its switch is on a Writing page.
    cy.openDoc("Talk on endurance");
    cy.get("[data-testid=reading-toggle]").click();
    cy.openDoc(SOURCE);
    content(BOX).click().type("Read, then kept");
    // An editor Command from the palette still reaches the box: Reading mode
    // locks the Writing page, not the box.
    content(BOX).type("{ctrl}a");
    cy.runCommand("Bold");
    content(BOX).should("contain", "Read, then kept");
    cy.get("[data-testid=capture-locator]").type("par. 77");
    content(BOX).type("{ctrl}{enter}");
    cy.get("[data-testid=hub-clippings]").should("contain", "Read, then kept");
    clippingText("par. 77").should("contain", "> **Read, then kept**");
    cy.openDoc("Talk on endurance");
    cy.get("[data-testid=reading-toggle]").click();
  });

  // A document dragged from a Composition's Candidates panel lands only in
  // that Composition's text (spec #202): never in a capture box.
  it("inserts nothing when a Candidate is dropped on it", () => {
    cy.bridge<{ summary: { id: string } }>("create_document", {
      docType: "note",
      title: "Stray note",
      fields: { tags: ["endurance"] },
      body: "",
    }).then(({ summary }) => {
      const row = `[data-testid=right-panel] [data-testid=candidate][data-doc="${summary.id}"] [data-testid=candidate-open]`;
      cy.openApp();
      cy.openDoc("Talk on endurance");
      cy.runCommand("Open in other Pane");
      cy.get("[data-testid=panes]").should("have.attr", "data-count", "2");
      // The palette opens in the last-used Pane: the right one.
      cy.openDoc(SOURCE);
      cy.get(`${pane(1)} ${BOX}`).should("exist");
      // The side panel follows the last-used Pane: the talk's Candidates.
      cy.get(`${pane(0)} .cm-content`).click();
      cy.docByTitle("Talk on endurance").then((talk) => {
        cy.get("[data-testid=right-panel]").should("have.attr", "data-doc", talk.id);
      });
      const data = new DataTransfer();
      const target = () => cy.get(`${pane(1)} ${BOX} .cm-content`);
      cy.get(row).trigger("dragstart", { dataTransfer: data });
      target().trigger("dragover", { dataTransfer: data });
      cy.get(`${pane(1)} ${BOX} .cm-dropCursor:visible`).should("not.exist");
      target().trigger("drop", { dataTransfer: data });
      cy.get(row).trigger("dragend", { dataTransfer: data });
      cy.wait(1000);
      target().should("not.contain", "Stray note");
      cy.get(`${pane(1)} ${BOX} .cm-placeholder`).should("exist");
      cy.get(`${pane(1)} [data-testid=pane-close]`).click();
      cy.get("[data-testid=panes]").should("have.attr", "data-count", "1");
    });
  });
});

/** The Writing page open behind a dialog (the dialog itself is portalled out of the Pane). */
const PAGE = "[data-testid=pane] .cm-content";

/**
 * A hover card sits on the word it describes, inside a dialog too: the
 * dialog is centred with a transform, which would otherwise carry the
 * fixed card off by the dialog's own offset.
 */
function expectCardBy(target: string) {
  cy.get(target).then(($t) => {
    const t = $t[0].getBoundingClientRect();
    cy.get("[data-testid=hover-card]").should(($c) => {
      const c = $c[0].getBoundingClientRect();
      expect(c.left, "card's left edge").to.be.lte(t.right + 1);
      expect(c.top, "card's top edge").to.be.lte(t.bottom + 12);
      // Below the word, or flipped above it.
      expect(c.top >= t.top || c.bottom <= t.bottom, "card beside the word").to.eq(true);
    });
  });
}

/** Escape with the autocomplete popup open closes only the popup; the next one closes the dialog. */
function escapeOrder(box: string) {
  content(box).click();
  typeSlowly(box, "See [[Geth");
  cy.get(".cm-tooltip-autocomplete").should("contain", "Gethsemane");
  content(box).type("{esc}");
  cy.get(".cm-tooltip-autocomplete").should("not.exist");
  cy.get("[role=dialog]").should("exist");
  content(box).should("contain", "See [[Geth");
  content(box).type("{esc}");
  cy.get("[role=dialog]").should("not.exist");
}

/** `[[` and `#` autocomplete, Enter picking the completion rather than making a line. */
function completes(box: string) {
  content(box).click();
  typeSlowly(box, "See [[Geth");
  cy.get(".cm-tooltip-autocomplete").should("contain", "Gethsemane");
  content(box).type("{enter}");
  cy.get(".cm-tooltip-autocomplete").should("not.exist");
  cy.get(`${box} .cm-wikilink`).should("contain", "Gethsemane");
  typeSlowly(box, "{end} #pra");
  cy.get(".cm-tooltip-autocomplete").should("contain", "prayer");
  content(box).type("{enter}");
  cy.get(`${box} .cm-tag`).should("contain", "prayer");
  cy.get(`${box} .cm-line`).should("have.length", 1);
  cy.get("[role=dialog]").should("exist");
}

/** Mod+B and Mod+L act on the box, never on the Writing page open behind the dialog. */
function boldsInTheBox(box: string, open: () => void) {
  cy.openDoc("Endurance in trials");
  cy.get(PAGE)
    .invoke("text")
    .then((before) => {
      open();
      content(box).click().type("bold me{ctrl}a{ctrl}b");
      content(box).type("{end}{enter}a task{ctrl}l");
      inSource(box, () => {
        content(box).should("contain", "**bold me**").and("contain", "- [ ] a task");
      });
      cy.get(PAGE).invoke("text").should("equal", before);
      cy.get("[role=dialog]").should("exist");
    });
}

const QUICK = "[data-testid=quick-capture-box]";

describe("Writing boxes: the Quick capture dialog", () => {
  const openQuick = () => {
    cy.get("body").type("{ctrl}{shift}n");
    cy.get(QUICK).should("be.visible");
  };
  beforeEach(() => {
    cy.openApp();
    cy.get("h1").should("contain", "Home");
  });

  it("has an accessible name", () => {
    openQuick();
    hasAccessibleName(QUICK);
  });

  it("autocompletes links with [[ and Tags with #, Enter picking the completion", () => {
    openQuick();
    completes(QUICK);
  });

  it("decorates a Passage and shows its hover card beside it, with no way out", () => {
    openQuick();
    content(QUICK).type("Read Jas 1:2-4 today");
    cy.get(`${QUICK} .cm-passage`).should("contain", "Jas 1:2-4").trigger("mouseover");
    cy.get("[data-testid=hover-card]").should("be.visible").and("not.contain", "Open page");
    expectCardBy(`${QUICK} .cm-passage`);
  });

  it("navigates nowhere when a link or Passage is clicked", () => {
    openQuick();
    content(QUICK).type("See [[Paul]] and Jas 1:2-4");
    cy.get(`${QUICK} .cm-wikilink`).contains("Paul").click({ ctrlKey: true });
    cy.get(`${QUICK} .cm-passage`).contains("Jas 1:2-4").click({ ctrlKey: true });
    cy.get("[role=dialog]").should("exist");
    content(QUICK).should("contain", "Jas 1:2-4");
    cy.get("h1").should("contain", "Home");
  });

  it("bolds with Mod+B in the box, not in the page behind it", () => {
    boldsInTheBox(QUICK, openQuick);
  });

  it("Ctrl/⌘+Enter creates and opens the Note; Enter is a new line", () => {
    openQuick();
    content(QUICK).type("first line{enter}second line");
    cy.get(`${QUICK} .cm-line`).should("have.length", 2);
    content(QUICK).type("{ctrl}{enter}");
    cy.get("[role=dialog]").should("not.exist");
    cy.get(PAGE).should("contain", "second line");
    capturedNotes().should((texts) => {
      expect(texts.some((t) => t.includes("first line\nsecond line"))).to.eq(true);
    });
  });

  it("closes the autocomplete popup on the first Escape, the dialog on the second", () => {
    openQuick();
    escapeOrder(QUICK);
  });

  it("keeps a pasted picture named by the time of the paste", () => {
    openQuick();
    pastePicture(`${QUICK} .cm-content`);
    cy.get(`${QUICK} [data-testid=picture][data-state=shown]`).should("exist");
    content(QUICK)
      .invoke("text")
      .should("match", /Attachments\/\d{4}-\d{2}-\d{2} \d{6} a35094\.png/);
  });

  it("starts 6 lines tall, grows to about 12, then scrolls inside", () => {
    openQuick();
    const scroller = `${QUICK} .cm-scroller`;
    content(QUICK).type("x");
    cy.get(`${QUICK} .cm-line`)
      .first()
      .invoke("outerHeight")
      .then((lh) => {
        const line = lh as number;
        cy.get(scroller).invoke("outerHeight").should("be.closeTo", 6 * line + 16, 4);
        content(QUICK).type("{enter}".repeat(19));
        cy.get(scroller).invoke("outerHeight").should("be.closeTo", 12 * line + 16, 8);
        cy.get(scroller).should(($s) => expect($s[0].scrollHeight).to.be.greaterThan($s[0].clientHeight));
      });
  });
});

const CLIP = "[data-testid=clipping-text]";

describe("Writing boxes: the New document dialog's Clipping text", () => {
  const openClipping = () => {
    cy.runCommand("New Clipping");
    cy.get(CLIP).should("be.visible");
  };
  const pickSource = (name: string) => {
    cy.get("[data-testid=source-picker]").type(name.slice(0, 12));
    cy.get("[data-testid=picker-option]").contains(name).click();
    cy.get("[data-testid=source-picker]").should("have.value", name);
  };
  beforeEach(() => {
    cy.openApp();
    cy.get("h1").should("contain", "Home");
  });

  it("has an accessible name, from its visible label", () => {
    openClipping();
    hasAccessibleName(CLIP);
    content(CLIP).should("have.attr", "aria-labelledby");
  });

  it("autocompletes links with [[ and Tags with #, Enter picking the completion", () => {
    openClipping();
    completes(CLIP);
  });

  it("decorates a Passage and shows its hover card beside it", () => {
    openClipping();
    content(CLIP).type("Read Jas 1:2-4 today");
    cy.get(`${CLIP} .cm-passage`).should("contain", "Jas 1:2-4").trigger("mouseover");
    cy.get("[data-testid=hover-card]").should("be.visible").and("not.contain", "Open page");
    expectCardBy(`${CLIP} .cm-passage`);
  });

  it("bolds with Mod+B in the box, not in the page behind it", () => {
    boldsInTheBox(CLIP, openClipping);
  });

  it("closes the autocomplete popup on the first Escape, the dialog on the second", () => {
    openClipping();
    escapeOrder(CLIP);
  });

  it("Ctrl/⌘+Enter creates the Clipping, quoted on every line with its markdown inside the quote", () => {
    openClipping();
    pickSource("Keep Enduring with Joy");
    content(CLIP).click().type("*A line* worth{enter}keeping, see [[Paul]]");
    cy.get(`${CLIP} .cm-line`).should("have.length", 2);
    content(CLIP).type("{ctrl}{enter}");
    cy.get("[role=dialog]").should("not.exist");
    cy.get("[data-testid=doc-citation]").should("contain", "Keep Enduring with Joy");
    cy.query<{ title: string; path: string }[]>({ kind: "list", docType: "clipping" }).then((clips) => {
      const texts: string[] = [];
      for (const c of clips) cy.task<string>("file:read", vaultFile(c.path)).then((t) => texts.push(t));
      cy.wrap(texts).should((all) => {
        const mine = all.find((t) => t.includes("*A line* worth"));
        expect(mine, "the new Clipping").to.exist;
        expect(mine).to.contain("> *A line* worth\n> keeping, see [[Paul]]");
      });
    });
  });

  it("names a pasted picture after the chosen Source", () => {
    openClipping();
    pickSource("Keep Enduring with Joy");
    content(CLIP).click();
    pastePicture(`${CLIP} .cm-content`);
    cy.get(`${CLIP} [data-testid=picture][data-state=shown]`).should("exist");
    content(CLIP).invoke("text").should("contain", "Attachments/keep enduring with joy a35094.png");
    cy.task<boolean>("file:exists", vaultFile("Attachments/keep enduring with joy a35094.png")).should("eq", true);
  });

  it("navigates nowhere when a link or Passage is clicked", () => {
    openClipping();
    content(CLIP).type("See [[Paul]] and Jas 1:2-4");
    cy.get(`${CLIP} .cm-wikilink`).contains("Paul").click();
    cy.get(`${CLIP} .cm-wikilink`).contains("Paul").click({ ctrlKey: true });
    cy.get(`${CLIP} .cm-passage`).contains("Jas 1:2-4").click({ ctrlKey: true });
    cy.get("[role=dialog]").should("exist");
    content(CLIP).should("contain", "Jas 1:2-4");
    cy.get("h1").should("contain", "Home");
    cy.get("[data-testid=panes]").should("not.have.attr", "data-count", "2");
  });

  it("starts 6 lines tall", () => {
    openClipping();
    content(CLIP).type("x");
    cy.get(`${CLIP} .cm-line`)
      .first()
      .invoke("outerHeight")
      .then((lh) => {
        cy.get(`${CLIP} .cm-scroller`).invoke("outerHeight").should("be.closeTo", 6 * (lh as number) + 16, 4);
      });
  });
});
