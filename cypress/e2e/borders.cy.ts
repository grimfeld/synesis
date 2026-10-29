// Drawing a region's Border on the Map (ADR 0023): click corners, double-click
// to close, and the region is drawn filled; the Border is a `.geojson` file
// beside the Place, named in its `border` Property. Egypt is the demo vault's
// region with coordinates and no Border (Judah has one already).
describe("Borders", () => {
  // Map filters and Colour by are this Device's real settings: start from
  // none, so the region wears its kind's colour, and put them back after.
  let saved = { books: [] as number[], mentionedOnly: false, colorBy: "kind" };
  before(() => {
    cy.bridge<{ map_books?: number[]; map_mentioned_only?: boolean; map_color_by?: string }>("get_settings").then((s) => {
      saved = { books: s.map_books ?? [], mentionedOnly: s.map_mentioned_only ?? false, colorBy: s.map_color_by ?? "kind" };
    });
  });
  after(() => cy.bridge("set_map_filters", saved));
  beforeEach(() => {
    cy.bridge("set_map_filters", { books: [], mentionedOnly: false, colorBy: "kind" });
    // The spec shares one copy of the demo vault: each test starts with Egypt
    // as the demo has it, a region with no Border.
    cy.docByTitle("Egypt").then((egypt) => cy.bridge("delete_border", { id: egypt.id }));
    cy.openApp();
  });

  const vaultFile = (rel: string) => `${Cypress.env("vault")}/${rel}`;

  /** Place three corners around the middle of the Map and double-click a fourth. */
  const drawSquare = () => {
    cy.get("[data-testid=map]").click(200, 150);
    cy.get("[data-testid=border-corner]").should("have.length", 1);
    cy.get("[data-testid=map]").click(320, 150);
    cy.get("[data-testid=map]").click(320, 260);
    cy.get("[data-testid=border-corner]").should("have.length", 3);
    cy.get("[data-testid=map]").dblclick(200, 260);
  };

  it("draws a Border from the region's Hub and shows the region filled", () => {
    cy.openDoc("Egypt");
    cy.hubTitle("Egypt");
    cy.get("[data-testid=hub-border]").should("exist");
    cy.get("[data-testid=border-none]").should("exist");
    cy.get("[data-testid=hub-border-draw]").click();

    cy.get("[data-testid=border-toolbar]").should("be.visible");
    cy.docByTitle("Egypt").then((egypt) => {
      cy.get("[data-testid=border-region]").should("have.value", egypt.id);
      drawSquare();
      cy.get("[data-testid=border-toolbar]").should("not.exist");
      // The region is drawn as a filled area in its own colour.
      cy.get(`[data-testid=map-border][data-id=${egypt.id}]`)
        .should("exist")
        .and("have.attr", "data-color", "--c-kind-region")
        .and("have.attr", "fill-opacity");
      // A `.geojson` beside the Place, named in `border`.
      const dir = egypt.path.replace(/[^/]+$/, "");
      cy.task<string | null>("file:read", vaultFile(`${dir}Egypt.geojson`)).then((text) => {
        const geo = JSON.parse(text ?? "{}");
        expect(geo.type).to.equal("FeatureCollection");
        expect(geo.features[0].geometry.type).to.equal("Polygon");
        expect(geo.features[0].geometry.coordinates[0]).to.have.length(5);
      });
      cy.task<string>("file:read", vaultFile(egypt.path)).then((text) => {
        expect(text).to.match(/^border: "\[\[Egypt\.geojson\]\]"$/m);
      });
    });
  });

  it("edits a Border's corners and deletes it", () => {
    cy.openDoc("Egypt");
    cy.get("[data-testid=hub-border-draw]").click();
    drawSquare();
    cy.docByTitle("Egypt").then((egypt) => cy.get(`[data-testid=map-border][data-id=${egypt.id}]`).should("exist"));

    // Back on the Hub the Border is named, and can be edited corner by corner.
    cy.openDoc("Egypt");
    cy.get("[data-testid=border-file]").should("contain", "Egypt.geojson");
    cy.get("[data-testid=hub-border-draw]").should("contain", "Edit Border").click();
    cy.get("[data-testid=border-corner]").should("have.length", 4);
    // While it is being edited, the saved area gives way to the draft.
    cy.get("[data-testid=map-border-draft]").should("exist");
    cy.docByTitle("Egypt").then((egypt) => {
      cy.get(`[data-testid=map-border][data-id=${egypt.id}]`).should("not.exist");
      const dir = egypt.path.replace(/[^/]+$/, "");
      const file = vaultFile(`${dir}Egypt.geojson`);
      cy.task<string>("file:read", file).then((before) => {
        // Drag one corner, then save.
        cy.get("[data-testid=border-corner]").first().parent()
          .trigger("mousedown", { button: 0, force: true })
          .trigger("mousemove", { clientX: 150, clientY: 120, force: true });
        cy.get("[data-testid=map]").trigger("mousemove", 140, 110, { force: true }).trigger("mouseup", { force: true });
        cy.get("[data-testid=border-save]").click();
        cy.get("[data-testid=border-toolbar]").should("not.exist");
        cy.task<string>("file:read", file).should("not.equal", before);
      });

      // Delete: the file and the Property go, and the region is a name again.
      cy.runCommand("Draw Border");
      cy.get("[data-testid=border-region]").select(egypt.id);
      cy.get("[data-testid=border-delete]").click();
      cy.get("[data-testid=confirm-batch]").click();
      cy.get(`[data-testid=map-border][data-id=${egypt.id}]`).should("not.exist");
      cy.task<boolean>("file:exists", file).should("equal", false);
      cy.task<string>("file:read", vaultFile(egypt.path)).should("not.match", /^border:/m);
    });
  });

  it("imports a Border from a .geojson file, every piece kept", () => {
    cy.openDoc("Egypt");
    cy.hubTitle("Egypt");
    cy.get("[data-testid=hub-border-import]").click();
    cy.get("[data-testid=border-input]").selectFile("cypress/fixtures/egypt.geojson", { force: true });
    cy.get("[data-testid=border-file]").should("contain", "Egypt.geojson");
    // Two pieces: the drawing mode cannot edit it corner by corner.
    cy.get("[data-testid=hub-border-draw]").should("contain", "Draw Border");
    cy.docByTitle("Egypt").then((egypt) => {
      const dir = egypt.path.replace(/[^/]+$/, "");
      cy.task<string | null>("file:read", vaultFile(`${dir}Egypt.geojson`)).then((text) => {
        const geo = JSON.parse(text ?? "{}");
        expect(geo.features[0].properties.name).to.equal("Egypt");
        expect(geo.features[0].geometry.type).to.equal("MultiPolygon");
        expect(geo.features[0].geometry.coordinates).to.have.length(2);
      });
      cy.task<string>("file:read", vaultFile(egypt.path)).then((text) => {
        expect(text).to.match(/^border: "\[\[Egypt\.geojson\]\]"$/m);
      });
      // On the Map the region is one filled area of two pieces.
      cy.runCommand("Go to Map");
      cy.get(`[data-testid=map-border][data-id=${egypt.id}]`)
        .should("have.length", 1)
        .invoke("attr", "d")
        .then((d) => expect(String(d).match(/M/g)).to.have.length(2));
    });
  });

  it("refuses a .geojson file with no area in it, saying why", () => {
    cy.openDoc("Egypt");
    cy.hubTitle("Egypt");
    cy.get("[data-testid=hub-border-import]").click();
    cy.get("[data-testid=border-input]").selectFile("cypress/fixtures/roads.geojson", { force: true });
    cy.get("[data-sonner-toast]").should("contain", "roads.geojson").and("contain", "no Polygon");
    cy.get("[data-testid=border-none]").should("exist");
    cy.docByTitle("Egypt").then((egypt) => {
      const dir = egypt.path.replace(/[^/]+$/, "");
      cy.task<boolean>("file:exists", vaultFile(`${dir}Egypt.geojson`)).should("equal", false);
      cy.task<string>("file:read", vaultFile(egypt.path)).should("not.match", /^border:/m);
    });
  });

  it("warns on the Place when its Border file cannot be read", () => {
    cy.docByTitle("Egypt").then((egypt) => {
      const dir = egypt.path.replace(/[^/]+$/, "");
      cy.task("file:write", { path: vaultFile(`${dir}Egypt.geojson`), text: '{"type":"Polygon"}' });
      cy.task<string>("file:read", vaultFile(egypt.path)).then((text) => {
        cy.task("file:write", {
          path: vaultFile(egypt.path),
          text: text.replace(/^kind: region$/m, 'kind: region\nborder: "[[Egypt.geojson]]"'),
        });
      });
    });
    cy.openDoc("Egypt");
    cy.get("[data-testid=border-warning]").should("have.attr", "data-status", "malformed").and("contain", "coordinates");
    // The Map draws nothing for it, and still shows the region by its name.
    cy.runCommand("Go to Map");
    cy.docByTitle("Egypt").then((egypt) =>
      cy.get(`[data-testid=map-border][data-id=${egypt.id}]`).should("not.exist"),
    );
    cy.contains("[data-testid=map-pin]", "Egypt").should("have.class", "no-pin");
  });
});
