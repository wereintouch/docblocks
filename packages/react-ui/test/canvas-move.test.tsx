// @vitest-environment jsdom
// The canvas move session (the pointer drag over a canvas item or the
// page miniature): the screen delta math (the threshold, the zoom
// division) and the hook's commit (one transact for the whole group —
// one undo step; the no-op drag and the Escape cancel write nothing).
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { useCanvasViewport } from "../src/canvas/viewport";

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const CREATED_AT = "2026-10-10T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

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
    // The preview stands after the drag (the render state — the idSet
    // stands the per-item O(1) membership read).
    expect(result.current.movePreview).toEqual({ ids: [a], idSet: new Set([a]), dx: 30, dy: 30 });
    act(() => {
      result.current.cancelMove();
    });

    expect(result.current.movePreview).toBeNull();
    expect(doc.toJSON()).toEqual(before);
  });

  it("stands the session's open state (the press window the preview does not reach)", () => {
    const { doc, a } = seededDoc();
    const { result } = renderHook(() => useCanvasViewport(doc));
    expect(result.current.moveSession).toBe(false);

    // The press stands the session (the pre-threshold window — the preview
    // is still null).
    act(() => {
      result.current.beginMove([a], 0, 0);
    });
    expect(result.current.moveSession).toBe(true);
    expect(result.current.movePreview).toBeNull();

    // The release clears it.
    act(() => {
      result.current.endMove();
    });
    expect(result.current.moveSession).toBe(false);

    // The cancel clears it (the in-flight preview dropped).
    act(() => {
      result.current.beginMove([a], 0, 0);
      result.current.moveDrag(30, 30);
    });
    expect(result.current.moveSession).toBe(true);
    act(() => {
      result.current.cancelMove();
    });
    expect(result.current.moveSession).toBe(false);
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
