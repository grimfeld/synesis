// The Board of a Composition: a JSON Canvas laid out by hand (ADR 0009).
// The demo vault's "Talk on endurance" ships a Board with every node type.
describe("Board", () => {
  beforeEach(() => cy.openApp());

  /**
   * Open a Composition's Board with the sidebar out of the way. Cypress runs
   * at 1280x720, where the sidebar covers the middle of the canvas that a new
   * node is dropped into, so a click meant for the Board hits a nav item.
   */
  const openBoard = (title: string) => {
    cy.openDoc(title);
    cy.get("[data-sidebar=trigger]").first().click();
    cy.get("[data-testid=tab-board]").click();
  };

  const opts = { pointerId: 1, isPrimary: true, button: 0, force: true };

  /**
   * Where a Board point is on screen, read from the canvas's own transform
   * (`translate(-x·zoom -y·zoom) scale(zoom)`), so a test can aim at a spot
   * of the demo Board whatever zoom fit-all chose.
   */
  const screenOf = (bx: number, by: number) =>
    cy.get("[data-testid=board-canvas]").then(($svg) => {
      const svg = $svg[0];
      const g = svg.querySelector(":scope > g")!;
      const m = /translate\(([-\d.e]+)[ ,]+([-\d.e]+)\)\s*scale\(([-\d.e]+)\)/.exec(g.getAttribute("transform")!)!;
      const r = svg.getBoundingClientRect();
      return { x: r.left + Number(m[1]) + bx * Number(m[3]), y: r.top + Number(m[2]) + by * Number(m[3]) };
    });

  /** The demo Board as the engine has it, once the debounced save landed. */
  type Saved = {
    nodes: { id: string; type: string; x: number; y: number; width: number; height: number; color?: string; label?: string }[];
    edges: { id: string; fromNode: string; toNode: string; label?: string }[];
  };
  const saved = (check: (b: Saved) => void) => {
    cy.wait(700); // the Board save is debounced
    cy.docByTitle("Talk on endurance").then((d) => {
      cy.bridge<Saved>("get_board", { id: d.id }).should(check);
    });
  };

  // Node ids in examples/demo-vault/Compositions/talk on endurance.canvas.
  const OPENING = "a1b2c3d4e5f60001";
  const TRIALS = "a1b2c3d4e5f60002";
  const WHO_RAN = "a1b2c3d4e5f60006";
  const CLOSE = "a1b2c3d4e5f60007";

  /** Select one node by its text; the selection bar says so. */
  const select = (text: string) => {
    cy.contains("[data-testid=board-canvas] div", text).click();
    cy.get("[data-testid=board-selection]").should("have.attr", "data-count", "1");
  };

  it("opens from the tab on a Composition and shows the demo Board", () => {
    openBoard("Talk on endurance");
    cy.get("[data-testid=board-canvas]").should("exist");
    // Every node type from the demo file.
    cy.get("[data-testid=board-canvas]").within(() => {
      cy.contains("Trials feel like the opposite of joy.").should("exist");
      // The Clipping's card: its own words, since it has no title (ADR 0013).
      cy.contains("Endurance is not merely putting up").should("exist");
      cy.contains("Opening").should("exist");
      cy.contains("because").should("exist");
    });
    // Back to the text.
    cy.get("[data-testid=tab-talk]").click();
    cy.get(".cm-content").should("contain", "Enduring with joy");
  });

  it("is offered only on Compositions", () => {
    cy.openDoc("Endurance in trials");
    cy.get("[data-testid=tab-board]").should("not.exist");
  });

  it("adds a note and keeps it after a reload", () => {
    openBoard("Talk on endurance");
    cy.get("[aria-label='Add note']").click();
    cy.focused().type("A new thought");
    cy.get("[data-testid=board-canvas]").click("bottom");
    cy.wait(700); // the Board save is debounced
    cy.get("[data-testid=board-canvas]").should("contain", "A new thought");

    // The engine wrote it: the Board survives the round trip to disk.
    cy.docByTitle("Talk on endurance").then((d) => {
      cy.bridge<{ nodes: { text?: string }[] }>("get_board", {
        id: d.id,
      }).should((b) => {
        expect(b.nodes.some((n) => n.text === "A new thought")).to.be.true;
      });
    });
  });

  it("places material from the drawer and marks it on the Board", () => {
    openBoard("Talk on endurance");
    // A Candidate that is not on the Board yet.
    cy.get("[data-testid=board-drawer]")
      .contains("Undeserved kindness in Romans")
      .click();
    cy.get("[data-testid=board-canvas]").should(
      "contain",
      "Undeserved kindness in Romans",
    );
    // Placing it does not make it used: it is still a Candidate, now marked.
    cy.get("[data-testid=tab-talk]").click();
    cy.get("[data-testid=right-panel]")
      .contains("button", "On the Board")
      .then(($b) => {
        // The Section remembers its open state, so only click it shut-to-open.
        if ($b.attr("data-state") !== "open") cy.wrap($b).click();
      });
    cy.get("[data-testid=right-panel] [data-testid=on-board]")
      .parent()
      .should("contain", "Undeserved kindness in Romans");
    cy.get("[data-testid=right-panel] [data-testid=candidates]")
      .parent()
      .should("not.contain", "Undeserved kindness in Romans");
  });

  it("reports the Boards a document sits on", () => {
    // Material placed on a Board is visible from the document's side, so a
    // Board is not a one-way mirror (PLAN §17.6).
    cy.docByTitle("Endurance in trials").then((d) => {
      cy.query<{ title: string }[]>({
        kind: "boardsReferencing",
        id: d.id,
      }).should((rows) => {
        expect(rows.map((r) => r.title)).to.include("Talk on endurance");
      });
    });
    // A document on no Board reports none.
    cy.docByTitle("Psalm 23 reflections").then((d) => {
      cy.query<unknown[]>({ kind: "boardsReferencing", id: d.id }).should(
        "have.length",
        0,
      );
    });
  });

  it("deletes a node with the keyboard", () => {
    openBoard("Talk on endurance");
    cy.get("[aria-label='Add note']").click();
    cy.focused().type("Doomed");
    cy.get("[data-testid=board-canvas]").click("bottom");
    cy.wait(700); // the Board save is debounced
    cy.get("[data-testid=board-canvas]").should("contain", "Doomed");
    cy.contains("[data-testid=board-canvas] div", "Doomed").click();
    cy.get("body").type("{del}");
    cy.get("[data-testid=board-canvas]").should("not.contain", "Doomed");
  });

  it("shows an imported card's text, not just its type", () => {
    // The whole point of the Board excerpt (PLAN §17.12): before this, a
    // `file` card showed its title and the bare word "Clipping".
    openBoard("Talk on endurance");
    cy.get("[data-testid=board-canvas]").within(() => {
      // The Clipping shows its quote.
      cy.contains("Endurance is not merely putting up with a trial").should(
        "exist",
      );
      // The Note shows its first line, not the heading repeating its title.
      cy.contains("consider it all joy").should("exist");
      // A subpath node shows that section, and says which section it is.
      cy.contains("Ro 5:3-5 links tribulation").should("exist");
      cy.contains("#Cross-references").should("exist");
    });
    // The type label gives way to the text it would otherwise crowd out.
    cy.contains("[data-testid=board-canvas] span", /^Clipping$/).should(
      "not.exist",
    );
  });

  it("exports the cards' text, even from reading mode", () => {
    // In reading mode a `file` card is a button, and the export used to strip
    // every button — which emptied every imported card in the SVG.
    openBoard("Talk on endurance");
    cy.get("[data-testid=board-mode]").click();
    cy.window().then(async (win) => {
      const mod = await win.eval("import('/src/lib/boardExport.ts')");
      const svg = mod.boardToSvg(
        win.document.querySelector("[data-testid=board-canvas]"),
        { nodes: [], edges: [] },
      );
      expect(svg, "the Clipping's quote").to.contain("remaining steadfast");
      expect(svg, "the Note's opening").to.contain("consider it all joy");
    });
  });

  it("arranges by default: a card drags instead of opening", () => {
    openBoard("Talk on endurance");
    // The demo Board carries a `file` node pointing at this Note.
    const card = () =>
      cy.contains("[data-testid=board-canvas] div", "Endurance in trials");

    card().then(($el) => {
      const before = $el[0].getBoundingClientRect();
      const x = before.left + 20;
      const y = before.top + 20;
      // A press on the card, then a drag past the slop and a release. Move and
      // release go to the host, which is where the canvas listens for them.
      const opts = { pointerId: 1, isPrimary: true, button: 0, force: true };
      card().trigger("pointerdown", { ...opts, clientX: x, clientY: y });
      cy.get("[data-testid=board-canvas]")
        .trigger("pointermove", { ...opts, clientX: x + 140, clientY: y + 90 })
        .trigger("pointerup", { ...opts, clientX: x + 140, clientY: y + 90 });

      // It moved, and it did not navigate away from the Board.
      cy.get("[data-testid=board-canvas]").should("exist");
      card().should(($after) => {
        const r = $after[0].getBoundingClientRect();
        expect(Math.round(r.left), "card did not move").to.not.equal(
          Math.round(before.left),
        );
      });
    });
  });

  it("opens a card's document in reading mode", () => {
    openBoard("Talk on endurance");
    cy.get("[data-testid=board-mode]").click();
    cy.contains("[data-testid=board-canvas] div", "Endurance in trials").click();
    // Navigated to the Note, so the Board is gone and its text is on screen.
    cy.get("[data-testid=board-canvas]").should("not.exist");
    cy.get(".cm-content", { timeout: 10000 }).should("contain", "Endurance");
  });

  it("puts the editing tools away while reading", () => {
    openBoard("Talk on endurance");
    cy.get("[aria-label='Add note']").should("exist");
    cy.get("[data-testid=board-drawer]").should("exist");

    cy.get("[data-testid=board-mode]").click();
    cy.get("[data-testid=board-mode]").should("have.attr", "aria-pressed", "true");
    cy.get("[aria-label='Add note']").should("not.exist");
    cy.get("[data-testid=board-drawer]").should("not.exist");

    // And back: arranging restores them.
    cy.get("[data-testid=board-mode]").click();
    cy.get("[data-testid=board-mode]").should("have.attr", "aria-pressed", "false");
    cy.get("[aria-label='Add note']").should("exist");
  });

  it("does not delete with the keyboard while reading", () => {
    openBoard("Talk on endurance");
    // Select a node, then switch to reading: the selection goes with it.
    cy.contains("[data-testid=board-canvas] div", "Trials feel like").click();
    cy.get("[data-testid=board-mode]").click();
    cy.get("body").type("{del}");
    cy.get("[data-testid=board-canvas]").should("contain", "Trials feel like");
  });

  it("keeps fields it does not understand through an edit", () => {
    // The hard requirement (PLAN §17.8): Obsidian's keys must survive us.
    cy.docByTitle("Talk on endurance").then((d) => {
      cy.bridge<{ nodes: Record<string, unknown>[]; edges: unknown[] }>(
        "get_board",
        { id: d.id },
      ).then((board) => {
        const nodes = board.nodes.map((n, i) =>
          i === 0 ? { ...n, styleAttributes: { shape: "diamond" } } : n,
        );
        cy.bridge("save_board", { id: d.id, board: { ...board, nodes } }).then(
          () => {
            cy.openApp();
            openBoard("Talk on endurance");
            // Move something, forcing a save from the app.
            cy.get("[aria-label='Add note']").click();
            cy.focused().type("Nudge");
            cy.get("[data-testid=board-canvas]").click("bottom");
            cy.wait(700); // the Board save is debounced
            cy.bridge<{ nodes: Record<string, unknown>[] }>("get_board", {
              id: d.id,
            }).should((after) => {
              const kept = after.nodes.find((n) => n.styleAttributes);
              expect(kept, "unknown field destroyed").to.exist;
            });
          },
        );
      });
    });
  });

  it("selects every node a dragged rectangle touches", () => {
    openBoard("Talk on endurance");
    // The strip between the Opening and Body groups is the demo Board's one
    // empty spot inside its bounds; dragging up and left from it touches the
    // Opening group and the bubble inside it, not the Clipping beside it.
    screenOf(0, -40).then((a) =>
      screenOf(-200, -200).then((b) => {
        cy.get("[data-testid=board-canvas]")
          .trigger("pointerdown", { ...opts, clientX: a.x, clientY: a.y })
          .trigger("pointermove", { ...opts, clientX: b.x, clientY: b.y })
          .trigger("pointerup", { ...opts, clientX: b.x, clientY: b.y });
      }),
    );
    cy.get("[data-testid=board-selection]").should("have.attr", "data-count", "2");
    // Escape lets the selection go.
    cy.get("body").type("{esc}");
    cy.get("[data-testid=board-selection]").should("not.exist");
  });

  it("resizes a node from its corner handle", () => {
    openBoard("Talk on endurance");
    select("Trials feel like the opposite of joy.");
    cy.get("[aria-label='Resize']").then(($h) => {
      const r = $h[0].getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      cy.wrap($h).trigger("pointerdown", { ...opts, clientX: x, clientY: y });
      // The handle follows the pointer on the window, wherever it wanders.
      cy.window().then((win) => {
        const at = (type: string) =>
          win.dispatchEvent(new win.PointerEvent(type, { pointerId: 1, clientX: x + 120, clientY: y + 80, bubbles: true }));
        at("pointermove");
        at("pointerup");
      });
    });
    saved((b) => {
      const n = b.nodes.find((n) => n.id === TRIALS)!;
      expect(n.width, "wider").to.be.greaterThan(300);
      expect(n.height, "taller").to.be.greaterThan(120);
    });
  });

  it("colours a node and takes the colour off again", () => {
    openBoard("Talk on endurance");
    // A press inside a group picks the card on top, not the group behind it.
    select("Trials feel like the opposite of joy.");
    cy.get("[aria-label='Colour 1']").click();
    saved((b) => {
      expect(b.nodes.find((n) => n.id === TRIALS)!.color).to.equal("1");
      expect(b.nodes.find((n) => n.id === OPENING)!.color, "the group keeps its own").to.equal("5");
    });
    cy.get("[aria-label='No colour']").click();
    saved((b) => expect(b.nodes.find((n) => n.id === TRIALS)!.color).to.equal(undefined));
  });

  it("draws a connection from a node's handle to another node", () => {
    openBoard("Talk on endurance");
    cy.docByTitle("Talk on endurance").then((d) => {
      cy.bridge<Saved>("get_board", { id: d.id }).then((before) => {
        select("Close on Ro 15:5");
        cy.get("[aria-label='Draw a connection']").trigger("pointerdown", opts);
        cy.contains("[data-testid=board-canvas] div", "Trials feel like the opposite of joy.").then(($t) => {
          const r = $t[0].getBoundingClientRect();
          const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
          cy.get("[data-testid=board-canvas]")
            .trigger("pointermove", { ...opts, ...at })
            .trigger("pointerup", { ...opts, ...at });
        });
        saved((b) => {
          expect(b.edges).to.have.length(before.edges.length + 1);
          expect(b.edges.some((e) => e.fromNode === CLOSE && e.toNode === TRIALS)).to.be.true;
        });
      });
    });
  });

  it("shows edge labels and edits one from the selection bar", () => {
    openBoard("Talk on endurance");
    cy.get("[data-testid=board-canvas]").should("contain", "because").and("contain", "leads to");
    // "Who ran before us" ends the one unlabelled edge, from the Note's card,
    // which is the first edge the selection bar finds for it.
    select("Who ran before us");
    cy.get("[data-testid=board-selection] [aria-label='Edge label']").click();
    cy.get("input[aria-label='Edge label']").should("have.value", "").type("then{enter}");
    cy.get("[data-testid=board-canvas]").should("contain", "then");
    saved((b) => {
      const e = b.edges.find((e) => e.toNode === WHO_RAN)!;
      expect(e.label).to.equal("then");
    });
  });

  it("moves a group on its own, renames it, and adds a coloured one", () => {
    openBoard("Talk on endurance");
    // A group is dragged by its empty area, and moves on its own: the cards
    // inside it stay where they are.
    screenOf(360, -80).then((a) => {
      cy.get("[data-testid=board-canvas]")
        .trigger("pointerdown", { ...opts, clientX: a.x, clientY: a.y })
        .trigger("pointermove", { ...opts, clientX: a.x + 60, clientY: a.y + 30 })
        .trigger("pointerup", { ...opts, clientX: a.x + 60, clientY: a.y + 30 });
    });
    saved((b) => {
      expect(b.nodes.find((n) => n.id === OPENING)!.x, "the group moved").to.not.equal(-420);
      const t = b.nodes.find((n) => n.id === TRIALS)!;
      expect([t.x, t.y], "the card inside stayed").to.deep.equal([-376, -248]);
    });
    // Renaming a group keeps its colour.
    cy.contains("[data-testid=board-canvas] text", /^Opening$/).dblclick({ force: true });
    cy.get("input[aria-label='Group label']").should("have.value", "Opening").clear().type("Start{enter}");
    saved((b) => {
      const g = b.nodes.find((n) => n.id === OPENING)!;
      expect(g.label).to.equal("Start");
      expect(g.color).to.equal("5");
    });
    // A new group is selected once added, so a colour lands on it.
    cy.get("[aria-label='Add group']").click();
    cy.contains("[data-testid=board-canvas] text", /^Group$/).dblclick({ force: true });
    cy.get("input[aria-label='Group label']").clear().type("Application{enter}");
    cy.contains("[data-testid=board-canvas] text", "Application").should("exist");
    cy.get("[data-testid=board-selection]").should("have.attr", "data-count", "1");
    cy.get("[aria-label='Colour 6']").click();
    saved((b) => {
      const g = b.nodes.find((n) => n.type === "group" && n.label === "Application");
      expect(g, "the group").to.exist;
      expect(g!.color).to.equal("6");
      expect([g!.width, g!.height]).to.deep.equal([520, 360]);
    });
  });
});
