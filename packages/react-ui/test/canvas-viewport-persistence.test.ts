// @vitest-environment jsdom
// The canvas viewport's browser persistence:
// the per-document zoom / pan over localStorage — the map docId -> { zoom,
// pan }. The round-trip, the multi-doc isolation, the corrupted / the
// wrong-shape read's null (the fit's fallback), the zoom's clamp, the
// storage's guards (the blocked / the non-browser stands the null read +
// the no-op write).
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readCanvasViewport, writeCanvasViewport } from "../src/canvas/viewport/persistence";

const KEY = "docblocks.canvas-viewport.v1";

describe("the canvas viewport's persistence (the localStorage's map)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("the round-trip: the write / the read stand the same zoom + pan", () => {
    writeCanvasViewport("doc-1", { zoom: 0.5, pan: { x: -120, y: 34.5 } });
    const stored = readCanvasViewport("doc-1");
    expect(stored).toEqual({ zoom: 0.5, pan: { x: -120, y: 34.5 } });
  });

  it("the multi-doc: the docIds' states stand isolated (one write stands the other none)", () => {
    writeCanvasViewport("doc-a", { zoom: 0.4, pan: { x: 10, y: 20 } });
    writeCanvasViewport("doc-b", { zoom: 1.5, pan: { x: -10, y: -20 } });
    expect(readCanvasViewport("doc-a")).toEqual({ zoom: 0.4, pan: { x: 10, y: 20 } });
    expect(readCanvasViewport("doc-b")).toEqual({ zoom: 1.5, pan: { x: -10, y: -20 } });
    // The unknown doc stands none (the fit's fallback).
    expect(readCanvasViewport("doc-c")).toBeNull();
  });

  it("the overwrite: the doc's second write stands the last value", () => {
    writeCanvasViewport("doc-1", { zoom: 0.5, pan: { x: 1, y: 2 } });
    writeCanvasViewport("doc-1", { zoom: 2, pan: { x: -1, y: -2 } });
    expect(readCanvasViewport("doc-1")).toEqual({ zoom: 2, pan: { x: -1, y: -2 } });
  });

  it("the zoom's clamp: an out-of-bounds stored zoom stands the 25% / 400% bound", () => {
    writeCanvasViewport("doc-1", { zoom: 99, pan: { x: 0, y: 0 } });
    expect(readCanvasViewport("doc-1")?.zoom).toBe(4);
    writeCanvasViewport("doc-1", { zoom: 0.01, pan: { x: 0, y: 0 } });
    expect(readCanvasViewport("doc-1")?.zoom).toBe(0.25);
  });

  it("the corrupted storage: the bad JSON / the wrong shape stand the null read", () => {
    window.localStorage.setItem(KEY, "{ not json");
    expect(readCanvasViewport("doc-1")).toBeNull();
    window.localStorage.setItem(KEY, JSON.stringify(["not", "a", "map"]));
    expect(readCanvasViewport("doc-1")).toBeNull();
    // A stored entry of the wrong shape (the missing / the non-finite fields).
    window.localStorage.setItem(KEY, JSON.stringify({ "doc-1": { zoom: "half", pan: { x: 1, y: 2 } } }));
    expect(readCanvasViewport("doc-1")).toBeNull();
    window.localStorage.setItem(KEY, JSON.stringify({ "doc-1": { zoom: 0.5 } }));
    expect(readCanvasViewport("doc-1")).toBeNull();
    // The missing entry (an empty map) stands none.
    window.localStorage.setItem(KEY, "{}");
    expect(readCanvasViewport("doc-1")).toBeNull();
  });

  it("the blocked storage: the localStorage's throw stands the null read + the no-op write", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      get: () => {
        throw new Error("storage blocked");
      },
      configurable: true,
    });
    expect(() => writeCanvasViewport("doc-1", { zoom: 0.5, pan: { x: 1, y: 2 } })).not.toThrow();
    expect(readCanvasViewport("doc-1")).toBeNull();
    if (original !== undefined) Object.defineProperty(window, "localStorage", original);
  });

  it("the non-browser: the absent window stands the null read + the no-op write", () => {
    vi.stubGlobal("window", undefined);
    try {
      expect(() => writeCanvasViewport("doc-1", { zoom: 0.5, pan: { x: 1, y: 2 } })).not.toThrow();
      expect(readCanvasViewport("doc-1")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
