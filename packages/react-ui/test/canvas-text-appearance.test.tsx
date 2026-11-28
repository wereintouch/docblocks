// @vitest-environment jsdom
// The canvas-text's render's stands: the box's text's centering (the
// selection's frame's parity), the side insets from the box's edges, the
// selection's outline stand, and the font attrs' render (the shape text's
// parity).
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";
import { pressBlock } from "./canvas-press";
import { CREATED_AT, renderCanvas } from "./canvas-text.helpers";

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
});

describe("the box's text centering (the selection's frame's parity)", () => {
  it("the canvas-text stands the box's vertical center (the wrapper's flex stand)", () => {
    const r = renderCanvas("seed");
    const wrapper = r.item().querySelector<HTMLElement>('[data-slot="docblocks/block"]');
    expect(wrapper).not.toBeNull();
    // The wrapper fills the item's box and centers the inner vertically
    // (the shape-text's parity — the selection's frame is the box).
    expect(wrapper!.className).toContain("justify-center");
    expect(wrapper!.className).toContain("flex-col");
    expect(wrapper!.className).toContain("h-full");
  });

  it("the ghost's inner stands the same vertical center (the caret's parity over the commit)", async () => {
    const r = renderCanvas("seed");
    fireEvent.doubleClick(r.view, { clientX: 100, clientY: 80 });
    const ghost = document.querySelector<HTMLElement>("[data-slot='docblocks/canvas-text-ghost-inner']");
    expect(ghost).not.toBeNull();
    expect(ghost!.className).toContain("items-center");
  });
});

describe("the side insets from the box's edges (the shape's text's parity)", () => {
  it("the item's wrapper stands the horizontal padding (the rect's 8 px x)", () => {
    const r = renderCanvas("seed");
    const item = r.item();
    // The border-box's stand (the preflight's box-sizing): the item's
    // border box stands the geometry — the selection's frame and the
    // position are unmoved, the text's wrap width stands the inset.
    expect(item.style.padding).toBe("0px 8px");
    expect(item.style.paddingTop).toBe("0px");
    expect(item.style.paddingLeft).toBe("8px");
    expect(item.style.paddingRight).toBe("8px");
  });

  it("the ghost's inner stands the same side inset (the commit's visual continuity)", async () => {
    const r = renderCanvas("seed");
    fireEvent.doubleClick(r.view, { clientX: 100, clientY: 80 });
    const ghost = document.querySelector<HTMLElement>("[data-slot='docblocks/canvas-text-ghost-inner']");
    expect(ghost).not.toBeNull();
    expect(ghost!.style.paddingLeft).toBe("8px");
    expect(ghost!.style.paddingRight).toBe("8px");
  });
});

describe("the selection's outline stand", () => {
  it("the selected canvas-text stands the shared selection outline (the shape's parity)", () => {
    const r = renderCanvas("seed");
    expect(r.item().hasAttribute("data-selected")).toBe(false);
    expect(r.item().className).not.toContain("outline-(--docblocks-canvas-selection-border-color)");

    pressBlock(r.view, r.doc, r.text);

    expect(r.item().hasAttribute("data-selected")).toBe(true);
    expect(r.item().className).toContain("outline-(--docblocks-canvas-selection-border-color)");
  });
});

describe("the font attrs' render (the shape text's parity)", () => {
  function renderFontAttrs(attrs: Record<string, unknown>): HTMLElement {
    const doc = createDoc({ id: "font-doc", createdAt: CREATED_AT });
    const surface = doc.insertBlock("surface");
    const id = doc.insertBlock("canvas-text", attrs, { parent: surface });
    doc.insertText(id, 0, "x");
    doc.setGeometry(id, { x: 0, y: 0, w: 100, h: 40 });
    const { container } = render(
      <EditorProvider doc={doc}>
        <Editor view="canvas" />
      </EditorProvider>
    );
    const item = container.querySelector<HTMLElement>(
      `[data-slot="docblocks/canvas-item"][data-block-id="${id}"]:not([data-slot="docblocks/row"])`
    );
    if (item === null) throw new Error("the canvas-text item is missing");
    return item;
  }

  it("stands the family's stack, the color, and the weight x the slant", () => {
    const item = renderFontAttrs({
      fontSize: 24,
      fontFamily: "Lora",
      textColor: "#e11d48",
      textStyle: "semibold-italic",
      textAlign: "right",
    });
    expect(item.style.fontSize).toBe("24px");
    // The CSSOM's serialization quotes the family's names (jsdom's
    // stand — the browser's computed stand is the same stack).
    expect(item.style.fontFamily).toBe('"Lora", Georgia, "Times New Roman", serif');
    expect(item.style.color).toBe("rgb(225, 29, 72)"); // #e11d48's CSSOM stand
    expect(item.style.fontWeight).toBe("600");
    expect(item.style.fontStyle).toBe("italic");
    expect(item.style.textAlign).toBe("right");
  });

  it("the unrecognized family stands the raw name (the consumer's font by name)", () => {
    const item = renderFontAttrs({ fontFamily: "My Custom Font" });
    expect(item.style.fontFamily).toBe('"My Custom Font"');
  });

  it("the light stand the 300 weight; the absent stand the regular 400", () => {
    const light = renderFontAttrs({ textStyle: "light" });
    expect(light.style.fontWeight).toBe("300");
    expect(light.style.fontStyle).toBe("");
    const regular = renderFontAttrs({});
    expect(regular.style.fontWeight).toBe("400");
    expect(regular.style.fontStyle).toBe("");
  });
});
