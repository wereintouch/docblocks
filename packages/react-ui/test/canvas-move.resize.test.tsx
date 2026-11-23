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

  it("stands the session's open state (the press window the preview does not reach)", () => {
    const { doc, a } = seededDoc();
    const { result } = renderHook(() => useCanvasViewport(doc));
    expect(result.current.resizeSession).toBe(false);

    // The press stands the session (the pre-threshold window — the preview
    // is still null).
    act(() => {
      result.current.beginResize(a, "e", 0, 0);
    });
    expect(result.current.resizeSession).toBe(true);
    expect(result.current.resizePreview).toBeNull();

    // The drag stands the preview; the session stands.
    act(() => {
      result.current.resizeDrag(40, 0, false);
    });
    expect(result.current.resizeSession).toBe(true);
    expect(result.current.resizePreview).not.toBeNull();

    // The release / the cancel clear it.
    act(() => {
      result.current.endResize();
    });
    expect(result.current.resizeSession).toBe(false);

    act(() => {
      result.current.beginResize(a, "e", 0, 0);
      result.current.resizeDrag(40, 0, false);
      result.current.cancelResize();
    });
    expect(result.current.resizeSession).toBe(false);
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
