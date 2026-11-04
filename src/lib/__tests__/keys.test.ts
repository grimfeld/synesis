// Where a shortcut's key is going (issue #62), Vitest: `npm run test:unit`.
import { describe, expect, it } from "vitest";
import { typingInField } from "../keys";

function el(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  return host.querySelector<HTMLElement>("[data-x]")!;
}

/** jsdom does not compute isContentEditable. */
function editable(e: HTMLElement): HTMLElement {
  Object.defineProperty(e, "isContentEditable", { value: true });
  return e;
}

describe("typingInField", () => {
  it("is true in a title, a Property, a select or a text area", () => {
    expect(typingInField(el(`<input data-x>`))).toBe(true);
    expect(typingInField(el(`<textarea data-x></textarea>`))).toBe(true);
    expect(typingInField(el(`<select data-x></select>`))).toBe(true);
  });

  it("is true in an editable element that is not the editor", () => {
    expect(typingInField(editable(el(`<div contenteditable="true" data-x></div>`)))).toBe(true);
  });

  it("is false in the note's editor, on the page and with no target", () => {
    const content = editable(
      el(`<div class="cm-editor"><div class="cm-content" contenteditable="true" data-x></div></div>`),
    );
    expect(typingInField(content)).toBe(false);
    expect(typingInField(document.body)).toBe(false);
    expect(typingInField(null)).toBe(false);
  });
});
