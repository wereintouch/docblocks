// @vitest-environment jsdom
// The shape's color toolbar (the single `shape` selection): the render
// conditions (the single shape stands it; the multi selection, the
// non-shape blocks, and the active tool hide it), the portaled input's
// press / key guards, and the sections' mutual exclusivity.
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { validateDoc } from "docblocks-core";

import { renderCanvas, seededDoc, selectBlock, toolbar } from "./canvas-shape-toolbar.helpers";

describe("the render conditions", () => {
  it("stands the toolbar for a single shape selection", () => {
    const { doc, shape } = seededDoc();
    const { view } = renderCanvas(doc);
    expect(toolbar()).toBeNull();

    selectBlock(view, doc, shape);
    expect(toolbar()).toBeTruthy();
  });

  it("hides the toolbar for the non-shape blocks (the canvas-text selection)", () => {
    const { doc, text } = seededDoc();
    const { view } = renderCanvas(doc);

    selectBlock(view, doc, text);
    expect(toolbar()).toBeNull();
  });

  it("hides the toolbar for the multi selection (the marquee group)", () => {
    const { doc, surface, shape } = seededDoc();
    const { container, view } = renderCanvas(doc);
    const second = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });

    // The marquee over the empty canvas: the press stands clear of the
    // seeded figures' zones (the shapes' outline bands, the text's box),
    // the crossing drag stands over the origin (the jsdom items' 0x0
    // boxes stand there) and selects the group.
    fireEvent.pointerDown(view, { clientX: -80, clientY: -70 });
    fireEvent.pointerMove(view, { clientX: 80, clientY: 70, buttons: 1 });
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
    const { view } = renderCanvas(doc);

    selectBlock(view, doc, shape);
    expect(toolbar()).toBeTruthy();
    // The shape tools are picked through the dock's shapes menu.
    fireEvent.pointerDown(screen.getByLabelText("Shapes"));
    fireEvent.click(screen.getByLabelText("Rectangle"));
    expect(toolbar()).toBeNull();
  });
});

it("a portaled palette press starts no canvas session (the DOM-containment guard)", () => {
  const { doc, shape } = seededDoc();
  const { view } = renderCanvas(doc);
  selectBlock(view, doc, shape);
  expect(toolbar()).toBeTruthy();

  fireEvent.click(screen.getByLabelText("Shape fill color"));
  const swatch = screen.getByLabelText("fill color 1");

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
  const { view } = renderCanvas(doc);
  selectBlock(view, doc, shape);

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
  const { view } = renderCanvas(doc);
  selectBlock(view, doc, shape);

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
  const { view } = renderCanvas(doc);
  selectBlock(view, doc, shape);

  // The non-modal popover does not close on an outside click: the fill
  // palette stands open until the toolbar's own state closes it. The
  // stroke trigger's open must close the fill (a per-section open state
  // would let both palettes stand at once).
  fireEvent.click(screen.getByLabelText("Shape fill color"));
  expect(screen.queryByRole("toolbar", { name: "Shape options" })).toBeTruthy();
  const fillPalette = document.querySelector("[data-slot='docblocks/shape-fill-palette']");
  expect(fillPalette).not.toBeNull();

  fireEvent.click(screen.getByLabelText("Shape stroke color"));
  expect(document.querySelector("[data-slot='docblocks/shape-fill-palette']")).toBeNull();
  expect(document.querySelector("[data-slot='docblocks/shape-stroke-palette']")).not.toBeNull();
  // the doc stands (the toggle applies nothing)
  expect(validateDoc(doc.toJSON())).toEqual([]);
});
