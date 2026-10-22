// @vitest-environment jsdom
// The canvas move session (the pointer drag over a canvas item or the
// page miniature): the screen delta math (the threshold, the zoom
// division) and the hook's commit (one transact for the whole group —
// one undo step; the no-op drag and the Escape cancel write nothing).
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/EditorProvider";
import { screenDeltaToCanvas } from "../src/canvas/viewport";
import { useCanvasViewport } from "../src/canvas/viewport-state";

afterEach(cleanup);

const CREATED_AT = "2026-10-10T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

/** The nested geometry Y.Map's write shape (the raw legacy seed below). */
interface RawGeometryMap {
  set(key: string, value: unknown): void;
}

function newDoc(): TestDoc {
  return createDoc({ id: "move-doc", createdAt: CREATED_AT });
}

function seededDoc(): { doc: TestDoc; surface: string; a: string; b: string } {
  const doc = newDoc();
  const surface = doc.insertBlock("surface");
  const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
  doc.setGeometry(a, { x: 10, y: 20, w: 100, h: 50 });
  const b = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
  doc.setGeometry(b, { x: -40, y: 30, w: 80, h: 60 });
  return { doc, surface, a, b };
}

describe("screenDeltaToCanvas", () => {
  it("returns null below the 3px screen threshold", () => {
    expect(screenDeltaToCanvas(2, 0, 1)).toBeNull();
    expect(screenDeltaToCanvas(0, 2, 1)).toBeNull();
    expect(screenDeltaToCanvas(2, 2, 1)).toBeNull(); // hypot(2,2) < 3
  });

  it("divides the delta by the zoom (the pan cancels out)", () => {
    expect(screenDeltaToCanvas(40, -20, 2)).toEqual({ x: 20, y: -10 });
    expect(screenDeltaToCanvas(9, 12, 0.5)).toEqual({ x: 18, y: 24 });
  });
});

describe("the move session", () => {
  it("moves a single item by the delta in one transact (one undo step)", () => {
    const { doc, a } = seededDoc();
    const { result } = renderHook(() => useCanvasViewport(doc));
    const before = doc.toJSON();

    act(() => {
      result.current.beginMove([a], 100, 100);
      result.current.moveDrag(140, 120); // 40/20 screen at zoom 1
      result.current.endMove();
    });

    expect(doc.getBlock(a)?.geometry).toEqual({ x: 50, y: 40, w: 100, h: 50 });
    // One undo step reverts the move.
    doc.undo();
    expect(doc.toJSON()).toEqual(before);
  });

  it("moves the whole group by one delta in one transact", () => {
    const { doc, a, b } = seededDoc();
    const { result } = renderHook(() => useCanvasViewport(doc));
    const before = doc.toJSON();

    act(() => {
      result.current.beginMove([a, b], 0, 0);
      result.current.moveDrag(30, -60);
      result.current.endMove();
    });

    expect(doc.getBlock(a)?.geometry).toEqual({ x: 40, y: -40, w: 100, h: 50 });
    expect(doc.getBlock(b)?.geometry).toEqual({ x: -10, y: -30, w: 80, h: 60 });
    // One undo step reverts BOTH (the transact batched them).
    doc.undo();
    expect(doc.toJSON()).toEqual(before);
  });

  it("scales the delta by the zoom", () => {
    const { doc, a } = seededDoc();
    const { result } = renderHook(() => useCanvasViewport(doc));

    // The hook starts at zoom 1 — zoom in in a separate act (the
    // moveDrag closure re-reads the zoom on the re-render), then drag:
    // the delta scales by the zoom.
    act(() => {
      result.current.setZoom(2);
    });
    act(() => {
      result.current.beginMove([a], 0, 0);
      result.current.moveDrag(40, 20); // 20/10 canvas at zoom 2
      result.current.endMove();
    });

    expect(doc.getBlock(a)?.geometry).toEqual({ x: 30, y: 30, w: 100, h: 50 });
  });

  it("writes nothing on a no-op release (below the threshold)", () => {
    const { doc, a, b } = seededDoc();
    const { result } = renderHook(() => useCanvasViewport(doc));
    const before = doc.toJSON();

    act(() => {
      result.current.beginMove([a, b], 50, 50);
      result.current.moveDrag(52, 51); // 2/1 screen — below the threshold
      result.current.endMove();
    });

    expect(doc.toJSON()).toEqual(before);
  });

  it("writes nothing on the Escape cancel (the preview is dropped)", () => {
    const { doc, a } = seededDoc();
    const { result } = renderHook(() => useCanvasViewport(doc));
    const before = doc.toJSON();

    act(() => {
      result.current.beginMove([a], 0, 0);
      result.current.moveDrag(30, 30);
    });
    // The preview stands after the drag (the render state).
    expect(result.current.movePreview).toEqual({ ids: [a], dx: 30, dy: 30 });
    act(() => {
      result.current.cancelMove();
    });

    expect(result.current.movePreview).toBeNull();
    expect(doc.toJSON()).toEqual(before);
  });

  it("moves a geometry-less item with the synthesized default box", () => {
    const doc = newDoc();
    const surface = doc.insertBlock("surface");
    const id = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    expect(doc.getBlock(id)?.geometry).toBeUndefined();
    const { result } = renderHook(() => useCanvasViewport(doc));

    act(() => {
      result.current.beginMove([id], 0, 0);
      result.current.moveDrag(25, 15);
      result.current.endMove();
    });

    expect(doc.getBlock(id)?.geometry).toEqual({ x: 25, y: 15, w: 100, h: 100 });
  });

  it("skips a vanished block in the group (a concurrent removal)", () => {
    const { doc, surface, a, b } = seededDoc();
    const { result } = renderHook(() => useCanvasViewport(doc));
    doc.removeBlock(b); // gone before the release

    act(() => {
      result.current.beginMove([a, b], 0, 0);
      result.current.moveDrag(10, 10);
      result.current.endMove();
    });

    expect(doc.getBlock(a)?.geometry).toEqual({ x: 20, y: 30, w: 100, h: 50 });
    expect(doc.getChildren(surface)).toEqual([a]);
  });

  it("moves the page miniature (the geometry-less root) with the default page box", () => {
    const doc = newDoc();
    expect(doc.getBlock(doc.meta.id)?.geometry).toBeUndefined();
    const { result } = renderHook(() => useCanvasViewport(doc));

    act(() => {
      result.current.beginMove([doc.meta.id], 0, 0);
      result.current.moveDrag(40, 25);
      result.current.endMove();
    });

    // The effective root box is the default page size (720x960).
    expect(doc.getBlock(doc.meta.id)?.geometry).toEqual({ x: 40, y: 25, w: 720, h: 960 });
  });

  it("skips the connector in the group (it carries no own geometry)", () => {
    const { doc, surface, a, b } = seededDoc();
    const connector = doc.insertBlock("connector", { start: { blockId: a }, end: { blockId: b } }, { parent: surface });
    expect(doc.getBlock(connector)?.geometry).toBeUndefined();
    const { result } = renderHook(() => useCanvasViewport(doc));

    act(() => {
      result.current.beginMove([a, b, connector], 0, 0);
      result.current.moveDrag(15, -10);
      result.current.endMove();
    });

    expect(doc.getBlock(a)?.geometry).toEqual({ x: 25, y: 10, w: 100, h: 50 });
    expect(doc.getBlock(b)?.geometry).toEqual({ x: -25, y: 20, w: 80, h: 60 });
    // The connector stands untouched: no phantom geometry is written.
    expect(doc.getBlock(connector)?.geometry).toBeUndefined();
  });
});

describe("the resize session", () => {
  it("resizes one item in one transact (one undo step)", () => {
    const { doc, a } = seededDoc();
    const { result } = renderHook(() => useCanvasViewport(doc));
    const before = doc.toJSON();

    act(() => {
      result.current.beginResize(a, "e", 0, 0);
      result.current.resizeDrag(40, 0, false); // 40px canvas on the e edge
      result.current.endResize();
    });

    // The e edge moved +40: the width grew, the center shifted by half.
    expect(doc.getBlock(a)?.geometry).toEqual({ x: 30, y: 20, w: 140, h: 50 });
    doc.undo();
    expect(doc.toJSON()).toEqual(before);
  });

  it("writes nothing on a no-op release (below the threshold)", () => {
    const { doc, a } = seededDoc();
    const { result } = renderHook(() => useCanvasViewport(doc));
    const before = doc.toJSON();

    act(() => {
      result.current.beginResize(a, "se", 0, 0);
      result.current.resizeDrag(2, 1, false);
      result.current.endResize();
    });

    expect(doc.toJSON()).toEqual(before);
  });

  it("writes nothing on the cancel (the preview is dropped)", () => {
    const { doc, a } = seededDoc();
    const { result } = renderHook(() => useCanvasViewport(doc));
    const before = doc.toJSON();

    act(() => {
      result.current.beginResize(a, "nw", 0, 0);
      result.current.resizeDrag(-30, -20, false);
      result.current.cancelResize();
    });

    expect(doc.toJSON()).toEqual(before);
    expect(result.current.resizePreview).toBeNull();
  });

  it("resizes the geometry-less root with the default page box", () => {
    const doc = newDoc();
    const { result } = renderHook(() => useCanvasViewport(doc));

    act(() => {
      result.current.beginResize(doc.meta.id, "e", 0, 0);
      result.current.resizeDrag(100, 0, false);
      result.current.endResize();
    });

    // The default page width (720) grew by 100 around the center.
    expect(doc.getBlock(doc.meta.id)?.geometry).toEqual({ x: 50, y: 0, w: 820, h: 960 });
  });

  it("ignores the connector (it carries no own geometry)", () => {
    const { doc, surface, a, b } = seededDoc();
    const connector = doc.insertBlock("connector", { start: { blockId: a }, end: { blockId: b } }, { parent: surface });
    const { result } = renderHook(() => useCanvasViewport(doc));

    act(() => {
      result.current.beginResize(connector, "e", 0, 0);
      result.current.resizeDrag(40, 0, false);
      result.current.endResize();
    });

    expect(doc.toJSON().v).toBe(1); // the doc stands untouched
    expect(doc.getBlock(connector)?.geometry).toBeUndefined();
  });
});

describe("the move preview on a legacy-rotated item", () => {
  it("stands the offset in the canvas axes (the stored rotation stands off the render)", () => {
    const doc = newDoc();
    const surface = doc.insertBlock("surface");
    const id = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    doc.setGeometry(id, { x: 0, y: 0, w: 100, h: 50 });
    // The legacy stored rotation (the strict schema no longer writes the
    // field): the raw CRDT write stands the data the lenient read keeps
    // and the render ignores.
    doc.raw.transact(() => {
      const entry = doc.raw.getMap("blocks").get(id) as { get(key: string): unknown };
      (entry.get("geometry") as RawGeometryMap).set("rotation", 90);
    });

    const { container } = render(
      <EditorProvider doc={doc}>
        <Editor view="canvas" />
      </EditorProvider>
    );
    const view = container.querySelector('[data-slot="docblocks/canvas-view"]');
    const wrapper = container.querySelector<HTMLElement>(`[data-slot="docblocks/canvas-item"][data-block-id="${id}"]`);
    if (view === null || wrapper === null) throw new Error("the canvas view / the item is missing");

    // The stored rotation stands no transform term (the render ignores
    // it): the resting transform is the centering translate only.
    expect(wrapper.style.transform).toBe("translate(-50%, -50%)");

    // The in-flight drag (the press on the item wrapper, the moves on
    // the view — the pointer is captured on the view): the preview
    // stands the canvas-axis offset.
    fireEvent.pointerDown(wrapper, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(view, { clientX: 140, clientY: 120, buttons: 1 });
    expect(wrapper.style.transform).toBe("translate(-50%, -50%) translate(40px, 20px)");

    // The release commits the canvas-axis delta (the commit writes
    // x/y/w/h only; the stored rotation survives the core's merge).
    fireEvent.pointerUp(view);
    expect(doc.getBlock(id)?.geometry).toEqual({ x: 40, y: 20, w: 100, h: 50, rotation: 90 });
  });
});
