// @vitest-environment jsdom
// The shape's drag-to-size placement (the dock's shapes menu gesture):
// the press starts the session (no commit yet), the drag stands the
// dashed preview (the marquee's gesture), the release commits the
// dragged size at the drag's midpoint (one transact); a sub-threshold
// click stands the default-size place. The stale-session drop (the
// button-less move) and the Escape cancel write nothing.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc, validateDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/EditorProvider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

interface Rendered {
  doc: TestDoc;
  view: HTMLElement;
  container: HTMLElement;
}

function renderCanvas(): Rendered {
  const doc = createDoc({ id: "dock-shapes-doc", createdAt: CREATED_AT });
  const surface = doc.insertBlock("surface");
  doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
  const { container } = render(
    <EditorProvider doc={doc}>
      <Editor view="canvas" />
    </EditorProvider>
  );
  const view = container.querySelector<HTMLElement>('[data-slot="docblocks/canvas-view"]');
  if (view === null) throw new Error("the canvas view is missing");
  return { doc, view, container };
}

/** Pick the shape tool through the dock's shapes menu. */
function pickShapeTool(view: HTMLElement, label: string): void {
  const trigger = view.querySelector<HTMLElement>('[data-tool="shapes"]');
  if (trigger === null) throw new Error("the shapes' button is missing");
  fireEvent.pointerDown(trigger);
  fireEvent.click(screen.getByLabelText(label));
}

/** The placed shapes of the doc (their geometry). */
function placedShapes(
  doc: TestDoc
): { variant: string | undefined; geometry: { x: number; y: number; w: number; h: number } | undefined }[] {
  return Object.values(doc.toJSON().blocks)
    .filter((block) => block.type === "shape")
    .map((block) => ({
      variant: (block.attrs as { variant?: string } | undefined)?.variant,
      geometry: block.geometry,
    }));
}

afterEach(cleanup);

describe("the drag-to-size placement", () => {
  it("commits the dragged size at the drag's midpoint (one transact)", () => {
    const { doc, view } = renderCanvas();
    pickShapeTool(view, "Ellipse");

    // The jsdom layout is 0x0: the client point IS the center-relative
    // point (zoom 1, pan 0).
    fireEvent.pointerDown(view, { clientX: 100, clientY: 100, button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerMove(view, { clientX: 130, clientY: 115, buttons: 1, pointerId: 1 });
    fireEvent.pointerMove(view, { clientX: 150, clientY: 130, buttons: 1, pointerId: 1 });
    // The preview stands during the drag (the shape's figure, dashed).
    const preview = view.querySelector('[data-slot="docblocks/canvas-place-preview"]');
    expect(preview).not.toBeNull();

    fireEvent.pointerUp(view, { clientX: 150, clientY: 130, pointerId: 1 });

    const shapes = placedShapes(doc);
    const placed = shapes.find((shape) => shape.variant === "ellipse");
    expect(placed).toBeDefined();
    expect(placed?.geometry).toEqual({ x: 125, y: 115, w: 50, h: 30 });
    expect(view.querySelector('[data-slot="docblocks/canvas-place-preview"]')).toBeNull();
    // The tool resets after a place.
    expect(view.querySelector('[data-tool="shapes"]')?.getAttribute("aria-pressed")).toBe("false");
    // One undo step: the placement is a single transact.
    doc.undo();
    expect(placedShapes(doc).find((shape) => shape.variant === "ellipse")).toBeUndefined();
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("stands the default-size place for the sub-threshold click", () => {
    const { doc, view } = renderCanvas();
    pickShapeTool(view, "Rectangle");

    fireEvent.pointerDown(view, { clientX: 100, clientY: 100, button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(view, { clientX: 101, clientY: 100, pointerId: 1 });

    const shapes = placedShapes(doc);
    // The seeded rect stands; the click place lands the default 160x80
    // at the click point.
    const placed = shapes.filter((shape) => shape.variant === "rect");
    expect(placed).toHaveLength(2);
    const mine = placed.find((shape) => shape.geometry?.w === 160 && shape.geometry?.x === 100);
    expect(mine?.geometry).toEqual({ x: 100, y: 100, w: 160, h: 80 });
  });

  it("divides the drag by the zoom (the place at a 1.2x zoom)", () => {
    const { doc, view } = renderCanvas();
    // Two zoom-in steps (the 10% step grid): the zoom is 1.2.
    fireEvent.click(screen.getByLabelText("Zoom in"));
    fireEvent.click(screen.getByLabelText("Zoom in"));
    pickShapeTool(view, "Ellipse");

    fireEvent.pointerDown(view, { clientX: 100, clientY: 100, button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerMove(view, { clientX: 200, clientY: 160, buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(view, { clientX: 200, clientY: 160, pointerId: 1 });

    const shapes = placedShapes(doc).find((shape) => shape.variant === "ellipse");
    expect(shapes?.geometry).not.toBeNull();
    // The screen delta (100/60) divided by the zoom: the canvas box is
    // 83.33x50 at the drag's canvas midpoint.
    expect(shapes?.geometry?.w).toBeCloseTo(100 / 1.2, 5);
    expect(shapes?.geometry?.h).toBeCloseTo(60 / 1.2, 5);
    expect(shapes?.geometry?.x).toBeCloseTo(100 / 1.2 + 100 / 2.4, 5);
    expect(shapes?.geometry?.y).toBeCloseTo(100 / 1.2 + 30 / 1.2, 5);
  });

  it("drops the session on the button-less move (the stale release writes nothing)", () => {
    const { doc, view } = renderCanvas();
    pickShapeTool(view, "Diamond");

    fireEvent.pointerDown(view, { clientX: 100, clientY: 100, button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerMove(view, { clientX: 150, clientY: 130, buttons: 1, pointerId: 1 });
    expect(view.querySelector('[data-slot="docblocks/canvas-place-preview"]')).not.toBeNull();
    // The lost release: the button-less move drops the session (the
    // preview drops).
    fireEvent.pointerMove(view, { clientX: 160, clientY: 135, buttons: 0, pointerId: 1 });
    expect(view.querySelector('[data-slot="docblocks/canvas-place-preview"]')).toBeNull();
    // The next release commits nothing (the session is gone).
    fireEvent.pointerUp(view, { clientX: 160, clientY: 135, pointerId: 1 });
    expect(placedShapes(doc).find((shape) => shape.variant === "diamond")).toBeUndefined();
  });

  it("the Escape cancels the in-flight placement (the tool resets, nothing lands)", () => {
    const { doc, view } = renderCanvas();
    pickShapeTool(view, "Line");

    fireEvent.pointerDown(view, { clientX: 100, clientY: 100, button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerMove(view, { clientX: 150, clientY: 130, buttons: 1, pointerId: 1 });
    expect(view.querySelector('[data-slot="docblocks/canvas-place-preview"]')).not.toBeNull();

    fireEvent.keyDown(view, { key: "Escape" });
    expect(view.querySelector('[data-slot="docblocks/canvas-place-preview"]')).toBeNull();
    expect(view.querySelector('[data-tool="shapes"]')?.getAttribute("aria-pressed")).toBe("false");

    fireEvent.pointerUp(view, { clientX: 150, clientY: 130, pointerId: 1 });
    expect(placedShapes(doc).find((shape) => shape.variant === "line")).toBeUndefined();
  });
});
