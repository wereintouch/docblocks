// @vitest-environment jsdom
// The canvas-text's text toolbar (the single `canvas-text` selection):
// the render conditions (the single text stands it; the multi selection,
// the non-text blocks, and the active tool hide it) and the applies (the
// font family, the text color, the text style, the font size, and the
// alignment — one updateBlock per apply, one undo step; the size's
// clamp).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDoc, validateDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

// A hex palette for the applies (jsdom cannot resolve the default palette's
// theme tokens — the commit would stand no write); the hex entries pass
// through, so the applies are deterministic.
const TEST_PALETTE = ["#3b82f6", "#e11d48", "#10b981"];

type TestDoc = ReturnType<typeof createDoc>;

function newDoc(): TestDoc {
  return createDoc({ id: "canvas-text-toolbar-doc", createdAt: CREATED_AT });
}

/** The canvas-text's attrs (the absent stand is the empty record). */
function textAttrs(doc: TestDoc, id: string): Record<string, unknown> {
  const block = doc.getBlock(id);
  if (block === null || block.type !== "canvas-text") return {};
  return { ...(block.attrs ?? {}) };
}

function seededDoc(): { doc: TestDoc; surface: string; text: string } {
  const doc = newDoc();
  const surface = doc.insertBlock("surface");
  const text = doc.insertBlock("canvas-text", undefined, { parent: surface });
  doc.insertText(text, 0, "the text");
  doc.setGeometry(text, { x: 0, y: 0, w: 200, h: 40 });
  return { doc, surface, text };
}

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

function renderCanvas(doc: TestDoc, palette: readonly string[] = TEST_PALETTE) {
  const utils = render(
    <EditorProvider doc={doc}>
      <Editor view="canvas" formatPalette={palette} />
    </EditorProvider>
  );
  const view = utils.container.querySelector('[data-slot="docblocks/canvas-view"]');
  if (view === null) throw new Error("the canvas view is missing");
  return { ...utils, view };
}

const toolbar = () => screen.queryByRole("toolbar", { name: "Text options" });

/** Click-select the block (the pointerdown on its canvas-item wrapper). */
function selectBlock(container: HTMLElement, id: string): void {
  const wrapper = container.querySelector<HTMLElement>(`[data-slot="docblocks/canvas-item"][data-block-id="${id}"]`);
  if (wrapper === null) throw new Error(`the canvas item ${id} is missing`);
  fireEvent.pointerDown(wrapper, { clientX: 10, clientY: 10 });
  fireEvent.pointerUp(wrapper);
}

describe("the render conditions", () => {
  it("stands the toolbar for a single canvas-text selection", () => {
    const { doc, text } = seededDoc();
    const { container } = renderCanvas(doc);
    expect(toolbar()).toBeNull();

    selectBlock(container, text);
    expect(toolbar()).toBeTruthy();
    // The text controls stand (the shape's parity — the shared stand's
    // slots).
    expect(document.querySelector("[data-slot='docblocks/canvas-text-toolbar-font-family']")).not.toBeNull();
    expect(document.querySelector("[data-slot='docblocks/canvas-text-toolbar-text-style']")).not.toBeNull();
    expect(document.querySelector("[data-slot='docblocks/canvas-text-toolbar-font-size']")).not.toBeNull();
  });

  it("hides the toolbar for a shape selection (the shape toolbar's stand)", () => {
    const { doc, surface } = seededDoc();
    const shape = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const { container } = renderCanvas(doc);

    selectBlock(container, shape);
    expect(toolbar()).toBeNull();
    expect(screen.queryByRole("toolbar", { name: "Shape options" })).toBeTruthy();
  });

  it("hides the toolbar for the multi selection (the marquee group)", () => {
    const { doc, surface, text } = seededDoc();
    const second = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    doc.setGeometry(second, { x: 300, y: 0, w: 100, h: 40 });
    const { container, view } = renderCanvas(doc);

    // The marquee over the empty canvas (both items' jsdom boxes stand at
    // the origin): a crossing drag selects the group.
    fireEvent.pointerDown(view, { clientX: -5, clientY: -5 });
    fireEvent.pointerMove(view, { clientX: 5, clientY: 5, buttons: 1 });
    fireEvent.pointerUp(view);

    expect(toolbar()).toBeNull();
    const selectedText = container.querySelector(
      `[data-slot="docblocks/canvas-item"][data-block-id="${text}"][data-selected]`
    );
    expect(selectedText).not.toBeNull();
  });

  it("hides the toolbar while a tool is active (the click-to-place intent)", () => {
    const { doc, text } = seededDoc();
    const { container } = renderCanvas(doc);

    selectBlock(container, text);
    expect(toolbar()).toBeTruthy();
    // The shape tools are picked through the dock's shapes menu.
    fireEvent.pointerDown(screen.getByLabelText("Shapes"));
    fireEvent.click(screen.getByLabelText("Rectangle"));
    expect(toolbar()).toBeNull();
  });
});

describe("the applies", () => {
  it("applies the font family in one undo step (the wrapper's stack stands)", () => {
    const { doc, text } = seededDoc();
    const { container } = renderCanvas(doc);
    selectBlock(container, text);

    fireEvent.pointerDown(screen.getByLabelText("Text font family"));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Lora" }));

    expect(textAttrs(doc, text).fontFamily).toBe("Lora");
    doc.undo();
    expect(textAttrs(doc, text).fontFamily).toBeUndefined();
  });

  it("applies the text color swatch in one undo step (the wrapper's color stands)", () => {
    const { doc, text } = seededDoc();
    const { container } = renderCanvas(doc);
    selectBlock(container, text);

    fireEvent.click(screen.getByLabelText("Text color"));
    const swatch = screen.getByLabelText("text color 2");
    fireEvent.click(swatch);

    expect(textAttrs(doc, text).textColor).toBe(TEST_PALETTE[1]);
    doc.undo();
    expect(textAttrs(doc, text).textColor).toBeUndefined();
  });

  it("applies the text style in one undo step", () => {
    const { doc, text } = seededDoc();
    const { container } = renderCanvas(doc);
    selectBlock(container, text);

    fireEvent.pointerDown(screen.getByLabelText("Text style"));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Semibold Italic" }));

    expect(textAttrs(doc, text).textStyle).toBe("semibold-italic");
    doc.undo();
    expect(textAttrs(doc, text).textStyle).toBeUndefined();
  });

  it("applies the font size (the 8–512 clamp; the invalid draft stands off)", () => {
    const { doc, text } = seededDoc();
    const { container } = renderCanvas(doc);
    selectBlock(container, text);

    const input = screen.getByLabelText("Text font size");
    fireEvent.change(input, { target: { value: "999" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(textAttrs(doc, text).fontSize).toBe(512); // the clamp's upper bound

    fireEvent.change(input, { target: { value: "4" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(textAttrs(doc, text).fontSize).toBe(8); // the clamp's lower bound

    // The invalid draft stands no write.
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(textAttrs(doc, text).fontSize).toBe(8);
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("applies the alignment in one undo step", () => {
    const { doc, text } = seededDoc();
    const { container } = renderCanvas(doc);
    selectBlock(container, text);

    fireEvent.click(screen.getByLabelText("Align center"));

    expect(textAttrs(doc, text).textAlign).toBe("center");
    doc.undo();
    expect(textAttrs(doc, text).textAlign).toBeUndefined();
  });

  it("stands the z-order menu (the surface's position / count; the pick's setZOrder)", () => {
    const { doc, surface, text } = seededDoc();
    // The second canvas element (the count < 2's absent stand needs the
    // two elements' surface).
    const second = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    doc.setGeometry(second, { x: 300, y: 0, w: 100, h: 40 });
    const { container } = renderCanvas(doc);
    selectBlock(container, text);

    // The menu stands (the text's position 0 over the two elements): the
    // backward's stands are disabled, the forward's stand.
    fireEvent.pointerDown(screen.getByLabelText("Arrange text"));
    expect(screen.getByRole("menuitem", { name: "Bring forward" }).getAttribute("data-disabled")).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Send backward" }).getAttribute("data-disabled")).not.toBeNull();

    fireEvent.click(screen.getByRole("menuitem", { name: "Bring forward" }));
    // The order's swap (the text stands the front — the position 1).
    const order = doc
      .getChildren(surface)
      .filter((id) => doc.getBlock(id)?.type === "canvas-text" || doc.getBlock(id)?.type === "shape");
    expect(order).toEqual([second, text]);
    doc.undo();
    expect(doc.getChildren(surface).filter((id) => id === text || id === second)).toEqual([text, second]);
  });
});
