// @vitest-environment jsdom
// The shape's color toolbar (the single `shape` selection): the render
// conditions (the single shape stands it; the multi selection, the
// non-shape blocks, and the active tool hide it) and the applies (a
// palette swatch, the "none" entry, and the custom hex input — one
// updateBlock per apply, one undo step; the invalid hex is ignored).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc, validateDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/EditorProvider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

function newDoc(): TestDoc {
  return createDoc({ id: "shape-color-doc", createdAt: CREATED_AT });
}

function shapeAttr(doc: TestDoc, id: string, name: "fill" | "stroke"): unknown {
  const block = doc.getBlock(id);
  if (block === null || block.type !== "shape") return null;
  return block.attrs?.[name] ?? null;
}

function seededDoc(): { doc: TestDoc; surface: string; shape: string; text: string } {
  const doc = newDoc();
  const surface = doc.insertBlock("surface");
  const shape = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
  doc.setGeometry(shape, { x: 0, y: 0, w: 200, h: 100 });
  const text = doc.insertBlock("canvas-text", { fontSize: 16 }, { parent: surface });
  return { doc, surface, shape, text };
}

afterEach(cleanup);

function renderCanvas(doc: TestDoc) {
  const utils = render(
    <EditorProvider doc={doc}>
      <Editor view="canvas" />
    </EditorProvider>
  );
  const view = utils.container.querySelector('[data-slot="docblocks/canvas-view"]');
  if (view === null) throw new Error("the canvas view is missing");
  return { ...utils, view };
}

const toolbar = () => screen.queryByRole("toolbar", { name: "Shape colors" });

/** Click-select the block (the pointerdown on its canvas-item wrapper). */
function selectBlock(container: HTMLElement, id: string): void {
  const wrapper = container.querySelector<HTMLElement>(`[data-slot="docblocks/canvas-item"][data-block-id="${id}"]`);
  if (wrapper === null) throw new Error(`the canvas item ${id} is missing`);
  fireEvent.pointerDown(wrapper, { clientX: 10, clientY: 10 });
  fireEvent.pointerUp(wrapper);
}

describe("the render conditions", () => {
  it("stands the toolbar for a single shape selection", () => {
    const { doc, shape } = seededDoc();
    const { container } = renderCanvas(doc);
    expect(toolbar()).toBeNull();

    selectBlock(container, shape);
    expect(toolbar()).toBeTruthy();
  });

  it("hides the toolbar for the non-shape blocks (the canvas-text selection)", () => {
    const { doc, text } = seededDoc();
    const { container } = renderCanvas(doc);

    selectBlock(container, text);
    expect(toolbar()).toBeNull();
  });

  it("hides the toolbar for the multi selection (the marquee group)", () => {
    const { doc, surface, shape } = seededDoc();
    const { container, view } = renderCanvas(doc);
    const second = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });

    // The marquee over the empty canvas (both items' jsdom boxes stand at
    // the origin): a crossing drag selects the group.
    fireEvent.pointerDown(view, { clientX: -5, clientY: -5 });
    fireEvent.pointerMove(view, { clientX: 5, clientY: 5, buttons: 1 });
    fireEvent.pointerUp(view);

    expect(toolbar()).toBeNull();
    // The marquee selected the group (both seeded shapes carry the
    // selection flag — the toolbar-hidden assertion alone would pass
    // for a no-op marquee as well).
    const selectedShape = container.querySelector(
      `[data-slot="docblocks/canvas-item"][data-block-id="${shape}"][data-selected]`
    );
    const selectedSecond = container.querySelector(
      `[data-slot="docblocks/canvas-item"][data-block-id="${second}"][data-selected]`
    );
    expect(selectedShape).not.toBeNull();
    expect(selectedSecond).not.toBeNull();
  });

  it("hides the toolbar while a tool is active (the click-to-place intent)", () => {
    const { doc, shape } = seededDoc();
    const { container } = renderCanvas(doc);

    selectBlock(container, shape);
    expect(toolbar()).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Rectangle"));
    expect(toolbar()).toBeNull();
  });
});

it("a portaled palette press starts no canvas session (the DOM-containment guard)", () => {
  const { doc, shape } = seededDoc();
  const { container } = renderCanvas(doc);
  selectBlock(container, shape);
  expect(toolbar()).toBeTruthy();

  fireEvent.click(screen.getByLabelText("Shape fill color"));
  const swatch = screen.getByLabelText("fill color #3b82f6");

  // The palette stands in document.body (the radix portal). React 19
  // dispatches the portal content's pointer events through the
  // component chain, so the container's pointer handler sees the
  // press with a target it does not contain: without the DOM-
  // containment guard a <3px marquee would reset the selection and
  // unmount the toolbar.
  fireEvent.pointerDown(swatch, { button: 0 });
  fireEvent.pointerUp(swatch, { button: 0 });

  expect(toolbar()).toBeTruthy();
});

it("a Backspace on the portaled hex input never deletes the selection (the root key guard)", () => {
  const { doc, shape } = seededDoc();
  const { container } = renderCanvas(doc);
  selectBlock(container, shape);

  fireEvent.click(screen.getByLabelText("Shape fill color"));
  const input = screen.getByLabelText("Shape fill color hex value");
  fireEvent.keyDown(input, { key: "Backspace" });
  fireEvent.keyDown(input, { key: "Delete" });

  // The input stands portaled outside the editor root; its keys must
  // not reach the editor root's blocks-selection handling (Delete /
  // Backspace on a blocks selection would remove the selected blocks).
  expect(doc.getBlock(shape) !== null).toBe(true);
  expect(toolbar()).toBeTruthy();
});

it("a Backspace on the portaled palette content never deletes the selection (the container key guard)", () => {
  const { doc, shape } = seededDoc();
  const { container } = renderCanvas(doc);
  selectBlock(container, shape);

  fireEvent.click(screen.getByLabelText("Shape fill color"));
  const palette = document.querySelector("[data-slot='docblocks/shape-fill-palette']");
  if (palette === null) throw new Error("the fill palette is missing");
  // The radix content div is focusable (tabIndex -1): a key on that focus
  // (the div is no form control) reaches the handlers through the fiber
  // path. The shape is no page-sequence member, so the root handler's
  // removeBlocksSelection skips it; the canvas container's key handler
  // (the DOM-containment guard) must not delete it through its own
  // deleteCanvasSelection path either.
  fireEvent.keyDown(palette, { key: "Backspace" });
  fireEvent.keyDown(palette, { key: "Delete" });

  expect(doc.getBlock(shape) !== null).toBe(true);
});

it("the sections are mutually exclusive (the other palette closes)", () => {
  const { doc, shape } = seededDoc();
  const { container } = renderCanvas(doc);
  selectBlock(container, shape);

  // The non-modal popover does not close on an outside click: the fill
  // palette stands open until the toolbar's own state closes it. The
  // stroke trigger's open must close the fill (a per-section open state
  // would let both palettes stand at once).
  fireEvent.click(screen.getByLabelText("Shape fill color"));
  expect(screen.queryByRole("toolbar", { name: "Shape colors" })).toBeTruthy();
  const fillPalette = document.querySelector("[data-slot='docblocks/shape-fill-palette']");
  expect(fillPalette).not.toBeNull();

  fireEvent.click(screen.getByLabelText("Shape stroke color"));
  expect(document.querySelector("[data-slot='docblocks/shape-fill-palette']")).toBeNull();
  expect(document.querySelector("[data-slot='docblocks/shape-stroke-palette']")).not.toBeNull();
  // the doc stands (the toggle applies nothing)
  expect(validateDoc(doc.toJSON())).toEqual([]);
});

describe("the applies", () => {
  it("applies the fill swatch in one undo step (the svg fill stands)", () => {
    const { doc, shape } = seededDoc();
    const { container } = renderCanvas(doc);
    selectBlock(container, shape);
    const before = doc.toJSON();

    // The fill section: the swatch stands directly in the open palette
    // (the popover is non-modal; the swatch click applies, the palette
    // stays open — the page format palette's behavior).
    fireEvent.click(screen.getByLabelText("Shape fill color"));
    const swatch = screen.getByLabelText("fill color #3b82f6");
    fireEvent.click(swatch);

    expect(shapeAttr(doc, shape, "fill")).toBe("#3b82f6");
    expect(validateDoc(doc.toJSON())).toEqual([]);
    doc.undo();
    expect(doc.toJSON()).toEqual(before);
  });

  it("applies the stroke swatch", () => {
    const { doc, shape } = seededDoc();
    const { container } = renderCanvas(doc);
    selectBlock(container, shape);

    fireEvent.click(screen.getByLabelText("Shape stroke color"));
    fireEvent.click(screen.getByLabelText("stroke color #e11d48"));

    expect(shapeAttr(doc, shape, "stroke")).toBe("#e11d48");
  });

  it("applies the none entry (the literal 'none' value)", () => {
    const { doc, shape } = seededDoc();
    const { container } = renderCanvas(doc);
    selectBlock(container, shape);
    doc.updateBlock(shape, { fill: "#111111" });

    fireEvent.click(screen.getByLabelText("Shape fill color"));
    fireEvent.click(screen.getByLabelText("No color"));

    expect(shapeAttr(doc, shape, "fill")).toBe("none");
  });

  it("applies the custom hex on Enter (3 and 6 digits; the invalid draft is ignored)", () => {
    const { doc, shape } = seededDoc();
    const { container } = renderCanvas(doc);
    selectBlock(container, shape);

    fireEvent.click(screen.getByLabelText("Shape fill color"));
    const input = screen.getByLabelText("Shape fill color hex value") as HTMLInputElement;

    // The invalid draft: no apply, the input keeps its text.
    fireEvent.change(input, { target: { value: "xyz" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(shapeAttr(doc, shape, "fill")).toBeNull();
    expect(input.value).toBe("xyz");

    // The 3-digit form applies (normalized to the `#` form, the 3 digits
    // stand — the svg fill accepts the short form); the popover closes
    // after a valid apply, so the next draft reopens it.
    fireEvent.change(input, { target: { value: "e11" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(shapeAttr(doc, shape, "fill")).toBe("#e11");

    // The 6-digit form applies; the invalid blur is ignored (the value
    // stands). The reopened section starts with an empty draft (the
    // apply closed it — the draft is the open popover's state).
    fireEvent.click(screen.getByLabelText("Shape fill color"));
    const input2 = screen.getByLabelText("Shape fill color hex value") as HTMLInputElement;
    expect(input2.value).toBe("");
    fireEvent.change(input2, { target: { value: "#a1b2c3" } });
    fireEvent.keyDown(input2, { key: "Enter" });

    fireEvent.click(screen.getByLabelText("Shape fill color"));
    const input3 = screen.getByLabelText("Shape fill color hex value");
    fireEvent.change(input3, { target: { value: "nope" } });
    fireEvent.blur(input3);
    expect(shapeAttr(doc, shape, "fill")).toBe("#a1b2c3");
  });
});
