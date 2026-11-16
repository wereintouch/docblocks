// @vitest-environment jsdom
/**
 * The mention chip's atomic stand over the flat-offset mapping: the chip is
 * a contenteditable=false island — the caret cannot stand inside the chip's
 * text, and a flat offset over the chip snaps to the nearest boundary (the
 * element slot before / after the chip in its own parent). The read path
 * (the caretOffsetIn's walk) counts the chip's text over the preceding
 * children, so the offset's domain is unchanged.
 */
import { describe, expect, it } from "vitest";

import { caretOffsetIn, locatePosition } from "../src/editing/dom-offset";

function chipOf(label: string): HTMLElement {
  const chip = document.createElement("span");
  chip.setAttribute("data-slot", "docblocks/mention");
  chip.setAttribute("contenteditable", "false");
  chip.textContent = label;
  return chip;
}

function containerOf(...children: Array<string | HTMLElement>): HTMLElement {
  const root = document.createElement("div");
  root.setAttribute("contenteditable", "true");
  for (const child of children) {
    if (typeof child === "string") root.appendChild(document.createTextNode(child));
    else root.appendChild(child);
  }
  document.body.appendChild(root);
  return root;
}

describe("the mention chip's atomic stand (the flat offset's mapping)", () => {
  it("a seat over the chip snaps to the nearest boundary (the chip's text is no seatable ground)", () => {
    // "ab" [0,2) + the chip "cd" [2,4) + "ef" [4,6).
    const root = containerOf("ab", chipOf("cd"), "ef");
    const at = (flatOffset: number) => locatePosition(root, flatOffset);

    // Over the preceding text: the text node's seat (unchanged).
    expect(at(1)).toEqual({ node: root.firstChild, offset: 1 });
    // The chip's start boundary: the end of the preceding text.
    expect(at(2)).toEqual({ node: root.firstChild, offset: 2 });
    // Strictly inside the chip: the nearer boundary (the slot before /
    // after the chip in its own parent — never the chip's text).
    const before = at(3);
    expect(before.node).toBe(root);
    expect((before as { offset: number }).offset).toBe(1);
    // The chip's end boundary (the pick's seat — after the chip, the type's
    // continuation keeps the editable).
    const after = at(4);
    expect(after.node).toBe(root);
    expect((after as { offset: number }).offset).toBe(2);
    // Over the following text: the text node's seat (unchanged).
    const ef = root.childNodes[2];
    expect(at(5)).toEqual({ node: ef, offset: 1 });

    // The read-back's domain: the element slots count the chip's text.
    expect(caretOffsetIn(root, root, 1)).toBe(2);
    expect(caretOffsetIn(root, root, 2)).toBe(4);
    root.remove();
  });

  it("a text that leads with the chip stands the slot before it over offset 0", () => {
    // The chip "cd" [0,2) + "ef" [2,4).
    const root = containerOf(chipOf("cd"), "ef");
    const start = locatePosition(root, 0);
    expect(start.node).toBe(root);
    expect((start as { offset: number }).offset).toBe(0);
    expect(caretOffsetIn(root, root, 0)).toBe(0);
    // The chip's end over the slot after it.
    const end = locatePosition(root, 2);
    expect(end.node).toBe(root);
    expect((end as { offset: number }).offset).toBe(1);
    root.remove();
  });

  it("two chips in a row stand the slots between them", () => {
    // The chip "ab" [0,2) + the chip "cd" [2,4) + "ef" [4,6).
    const root = containerOf(chipOf("ab"), chipOf("cd"), "ef");
    // The first chip's end (the second's start): the slot between them.
    const between = locatePosition(root, 2);
    expect(between.node).toBe(root);
    expect((between as { offset: number }).offset).toBe(1);
    expect(caretOffsetIn(root, root, 1)).toBe(2);
    root.remove();
  });
});
