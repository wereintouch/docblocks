// @vitest-environment jsdom
// The canvas container / frame title chips over the screen layer: the
// chip's seat (the block's own box mapped through the zoom / pan — the
// chip stands above the world's paint order and keeps its on-screen size),
// the seat rides the in-flight move preview, the culling's stand (an
// off-viewport chip renders no DOM), the chip's own block identity, and the
// read-only stand (the chip renders inert — no press, no inline edit).
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-11-19T00:00:00.000Z";
const STORAGE_KEY = "docblocks.canvas-viewport.v1";

type TestDoc = ReturnType<typeof createDoc>;

/** The title chip's seat (the screen layer's positioned box per block). */
function seatOf(root: ParentNode, id: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-slot="docblocks/canvas-title-chip"][data-block-id="${id}"]`);
}

/** The seeded scene: one surface with a titled container. */
function seedScene(
  docId: string,
  geometry: { x: number; y: number; w: number; h: number }
): {
  doc: TestDoc;
  group: string;
} {
  const doc = createDoc({ id: docId, createdAt: CREATED_AT });
  const surface = doc.insertBlock("surface");
  const group = doc.insertBlock("group", { members: [], title: "Board" }, { parent: surface });
  doc.setGeometry(group, geometry);
  return { doc, group };
}

/** The persisted viewport (the canvas view's restore's read on mount). */
function seedViewport(docId: string, zoom: number, pan: { x: number; y: number }): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ [docId]: { zoom, pan } }));
}

function renderCanvas(doc: TestDoc, mode?: "edit" | "view") {
  const { container } = render(
    <EditorProvider doc={doc} mode={mode}>
      <Editor view="canvas" />
    </EditorProvider>
  );
  const view = container.querySelector<HTMLElement>('[data-slot="docblocks/canvas-view"]');
  if (view === null) throw new Error("the canvas view is missing");
  return { container, view };
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
});

describe("the title chip's screen seat", () => {
  it("maps the block's box through the zoom / pan and keeps the chip out of the world's scale", () => {
    seedViewport("title-chip-zoom", 2, { x: 100, y: 50 });
    const { doc, group } = seedScene("title-chip-zoom", { x: 0, y: 0, w: 200, h: 150 });
    const { container, view } = renderCanvas(doc);
    const seat = seatOf(view, group)!;
    expect(seat).not.toBeNull();
    // The seat's screen box: the center over the zoom / pan, the size over
    // the zoom's scale (the chip's offsets resolve against it — the chip's
    // own px stand the screen's, not the world's).
    expect(seat.style.left).toBe("calc(50% + 100px)");
    expect(seat.style.top).toBe("calc(50% + 50px)");
    expect(seat.style.width).toBe("400px");
    expect(seat.style.height).toBe("300px");
    expect(seat.style.transform).toBe("translate(-50%, -50%)");
    // The chip's own block identity (the dblclick's entry's read).
    const chip = seat.querySelector<HTMLElement>("[data-slot='docblocks/group-title']")!;
    expect(chip.getAttribute("data-block-id")).toBe(group);
    expect(chip.textContent).toBe("Board");
    // The chip stands outside the canvas item's wrapper (the occlusion-free
    // layer — a figure over the box cannot cover it).
    expect(chip.closest('[data-slot="docblocks/canvas-item"]')).toBeNull();
    // The seat itself is pointer-transparent: only the chip catches the
    // press (the covered box keeps the press of what lies beneath).
    expect(seat.style.pointerEvents).toBe("none");
    expect(chip.style.pointerEvents).toBe("auto");
    void container;
  });

  it("rides the in-flight move preview (the seat follows the dragged box)", () => {
    const { doc, group } = seedScene("title-chip-preview", { x: 0, y: 0, w: 200, h: 150 });
    const { view } = renderCanvas(doc);
    const seat = seatOf(view, group)!;
    const chip = seat.querySelector<HTMLElement>("[data-slot='docblocks/group-title']")!;
    // The chip's press starts the move session (the item's press contract:
    // the selection + the move, no fall-through to the canvas's branches).
    act(() => {
      fireEvent.pointerDown(chip, { clientX: 0, clientY: 0, pointerId: 1, button: 0 });
    });
    expect(seatOf(view, group)!.style.left).toBe("calc(50% + 0px)");
    act(() => {
      fireEvent.pointerMove(view, { clientX: 40, clientY: 20, pointerId: 1, buttons: 1 });
    });
    // The live seat stands the preview's delta over the committed center.
    expect(seatOf(view, group)!.style.left).toBe("calc(50% + 40px)");
    expect(seatOf(view, group)!.style.top).toBe("calc(50% + 20px)");
    act(() => {
      fireEvent.pointerUp(view, { pointerId: 1 });
    });
    // The release commits the move: the seat stands the new center (the
    // document's own geometry).
    const block = doc.getBlock(group);
    expect(block?.geometry).toEqual({ x: 40, y: 20, w: 200, h: 150 });
    expect(seatOf(view, group)!.style.left).toBe("calc(50% + 40px)");
  });

  it("renders no DOM for a chip outside the viewport's cull set", () => {
    const { doc, group } = seedScene("title-chip-culling", { x: 5000, y: 0, w: 200, h: 150 });
    const { view } = renderCanvas(doc);
    expect(seatOf(view, group)).toBeNull();
  });

  it("stands the chip inert over the read-only view (no press, no inline edit)", () => {
    const { doc, group } = seedScene("title-chip-view", { x: 0, y: 0, w: 200, h: 150 });
    const { view } = renderCanvas(doc, "view");
    const seat = seatOf(view, group)!;
    const chip = seat.querySelector<HTMLElement>("[data-slot='docblocks/group-title']")!;
    expect(chip.textContent).toBe("Board");
    expect(chip.style.pointerEvents).toBe("none");
    act(() => {
      fireEvent.dblClick(chip);
    });
    expect(view.querySelector("[data-slot='docblocks/group-title-edit']")).toBeNull();
  });
});
