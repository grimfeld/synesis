/// <reference types="cypress" />

// Dragging a document row into a Composition's text (spec #202), the way the
// browser would: one DataTransfer from `dragstart` to `dragend`. Cypress
// cannot drive a native drag, so the events are synthetic; the app reads the
// same DataTransfer at `dragover` and `drop`.

/**
 * Drag the row button at `row` onto the editor line holding `line`. `within`
 * scopes the line to one editor (a Pane, the split talk).
 */
export function dragRowOntoLine(row: string, line: string, within = "") {
  const data = new DataTransfer();
  const target = `${within} .cm-line`.trim();
  cy.get(row).trigger("dragstart", { dataTransfer: data });
  cy.get(row).should("have.attr", "data-dragging", "true");
  cy.contains(target, line).trigger("dragover", { dataTransfer: data });
  cy.contains(target, line).trigger("drop", { dataTransfer: data });
  cy.get(row).trigger("dragend", { dataTransfer: data });
  cy.get(row).should("not.have.attr", "data-dragging");
}
