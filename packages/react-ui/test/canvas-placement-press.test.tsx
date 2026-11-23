// @vitest-environment jsdom
// The pending stand's commit (the press's snap stand): the port's / the
// free's / the legacy free's / the plain block's stands' commit (the
// press point's re-snap, the frozen direction) + the stand's attributes'
// clear over the cancel.
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { useCanvasViewport } from "../src/canvas/viewport";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

function newDoc(): TestDoc {
  return createDoc({ id: "placement-doc", createdAt: CREATED_AT });
}

afterEach(cleanup);

describe("the pending stand's commit (the press's snap stand)", () => {
  function connectorDoc() {
    const doc = newDoc();
    const surface = doc.insertBlock("surface");
    const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    doc.setGeometry(a, { x: -100, y: 0, w: 100, h: 60 });
    const b = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    doc.setGeometry(b, { x: 100, y: 0, w: 100, h: 60 });
    return { doc, surface, a, b };
  }

  function lastConnector(doc: TestDoc, surface: string) {
    const child = doc
      .getChildren(surface)
      .map((id) => doc.getBlock(id))
      .find((block) => block?.type === "connector");
    if (child === undefined || child === null || child.type !== "connector") {
      throw new Error("the connector is missing");
    }
    return child.attrs;
  }

  it("the port stand commits the port ref (no re-snap at the press point)", () => {
    const { doc, surface, a, b } = connectorDoc();
    const { result } = renderHook(() => useCanvasViewport(doc));

    act(() => {
      result.current.setPendingStand({ blockId: a, port: "north" }, { x: -100, y: -33 });
    });
    act(() => {
      result.current.onConnectorCommit({ blockId: b }, { x: 100, y: 0 });
    });

    // The port stand stands the legacy port ref (the portT's 0.5 stand —
    // the endpoint drag's commit parity); the second stand's release
    // (the right box's center) stands off the ports — the plain ref.
    expect(lastConnector(doc, surface)).toEqual({
      start: { blockId: a, port: "north", portT: 0.5 },
      end: { blockId: b },
      zIndex: 3,
    });
  });

  it("the free stand commits the press point with the frozen direction", () => {
    const { doc, surface, b } = connectorDoc();
    const { result } = renderHook(() => useCanvasViewport(doc));

    act(() => {
      result.current.setPendingStand({ free: { x: -30, y: 40 }, freePort: "south" }, { x: -30, y: 40 });
    });
    act(() => {
      result.current.onConnectorCommit({ blockId: b }, { x: 100, y: 40 });
    });

    // The release point (100, 40) stands 10px from B's south port (the
    // disk's): the second stand's release snap stands the port ref (the
    // legacy commit's contract).
    expect(lastConnector(doc, surface)).toEqual({
      start: { x: -30, y: 40, port: "south" },
      end: { blockId: b, port: "south", portT: 0.5 },
      zIndex: 3,
    });
  });

  it("the legacy free stand (the empty-canvas press) stands no direction", () => {
    const { doc, surface, b } = connectorDoc();
    const { result } = renderHook(() => useCanvasViewport(doc));

    act(() => {
      result.current.setPendingStand({ free: { x: 0, y: 50 } }, { x: 0, y: 50 });
    });
    act(() => {
      result.current.onConnectorCommit({ blockId: b }, { x: 100, y: 50 });
    });

    expect(lastConnector(doc, surface)).toEqual({ start: { x: 0, y: 50 }, end: { blockId: b }, zIndex: 3 });
  });

  it("the plain block stand (the interior press) re-snaps at the press point (the legacy path)", () => {
    const { doc, surface, a, b } = connectorDoc();
    const { result } = renderHook(() => useCanvasViewport(doc));

    act(() => {
      // The interior press (the box's center): no snap at the press. The
      // source stands the self-pair guard (the stand's own block).
      result.current.setPendingStand({ blockId: a, source: a }, { x: -100, y: 0 });
    });
    expect(result.current.pendingSource).toBe(a);
    act(() => {
      result.current.onConnectorCommit({ blockId: b }, { x: 100, y: 0 });
    });

    expect(lastConnector(doc, surface)).toEqual({ start: { blockId: a }, end: { blockId: b }, zIndex: 3 });
  });

  it("clears the stand's attributes on the cancel", () => {
    const { doc, a } = connectorDoc();
    const { result } = renderHook(() => useCanvasViewport(doc));

    act(() => {
      result.current.setPendingStand({ blockId: a, port: "east" }, { x: 0, y: 0 });
    });
    expect(result.current.pendingPort).toBe("east");

    act(() => {
      result.current.setPendingStand({ free: { x: 1, y: 2 }, freePort: "south" }, { x: 1, y: 2 });
    });
    expect(result.current.pendingFreePort).toBe("south");
    expect(result.current.pendingPort).toBeNull();

    act(() => {
      result.current.setPendingStand(null);
    });
    expect(result.current.pendingPort).toBeNull();
    expect(result.current.pendingFreePort).toBeNull();
    expect(result.current.pendingSource).toBeNull();
    expect(result.current.pendingConnector).toBeNull();
    expect(result.current.pendingFree).toBeNull();
  });
});
