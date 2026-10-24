// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import { createDoc, fromJSON } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/EditorProvider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

/** Deterministic ids: z0001 surface, then the elements in insertion order. */
function canvasIdGenerator(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `z${String(next).padStart(4, "0")}`;
  };
}

function newDoc(): TestDoc {
  return createDoc({ id: "outer", createdAt: CREATED_AT, generateId: canvasIdGenerator() });
}

function renderCanvas(doc: TestDoc, view: "page" | "canvas" = "canvas") {
  render(
    <EditorProvider doc={doc}>
      <Editor view={view} />
    </EditorProvider>
  );
  return doc;
}

/** The canvas-item wrappers in DOM order (the paint order pin). */
function canvasItemIds(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-slot='docblocks/canvas-item']")).map(
    (el) => el.dataset.blockId as string
  );
}

/** The block's `zIndex` stand (-1 when absent). */
function zIndexOf(doc: TestDoc, id: string): number {
  const block = doc.getBlock(id) as { attrs?: { zIndex?: number } } | null;
  return block?.attrs?.zIndex ?? -1;
}

/** The surface (z0001) + the shapes (z0002, z0004) with the frame in between. */
function threeShapeDoc(): TestDoc {
  const doc = newDoc();
  const surface = doc.insertBlock("surface");
  const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
  doc.insertBlock("frame", undefined, { parent: surface });
  const b = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
  doc.setGeometry(a, { x: -100, y: 0, w: 80, h: 60 });
  doc.setGeometry(b, { x: 100, y: 0, w: 80, h: 60 });
  return doc;
}

describe("the canvas z-order's paint stand (the 2026-10-22 explicit zIndex)", () => {
  afterEach(cleanup);

  it("the DOM order follows the dense zIndex (the reorder's paint change)", () => {
    const doc = renderCanvas(threeShapeDoc());
    const surface = "z0001";
    const a = "z0002";
    const b = "z0004";
    // The children order IS the z-order: a=1, b=2 (the frame stands no
    // zIndex — it is not a figure).
    expect(zIndexOf(doc, a)).toBe(1);
    expect(zIndexOf(doc, b)).toBe(2);
    expect(zIndexOf(doc, "z0003")).toBe(-1);
    expect(canvasItemIds()).toEqual([a, "z0003", b]);

    act(() => {
      doc.setZOrder(a, "toFront");
    });
    // a stands on top: the paint order (the DOM order) reorders with it,
    // the indices re-densify over the canvas elements (the frame stands
    // no index), the frame's position stands.
    expect(doc.getChildren(surface)).toEqual([b, "z0003", a]);
    expect(canvasItemIds()).toEqual([b, "z0003", a]);
    expect(zIndexOf(doc, a)).toBe(2);
    expect(zIndexOf(doc, b)).toBe(1);
    expect(zIndexOf(doc, "z0003")).toBe(-1);
  });

  it("a connector can stand under a figure (the interleaved paint order)", () => {
    const d = newDoc();
    const surface = d.insertBlock("surface");
    const a = d.insertBlock("shape", { variant: "rect" }, { parent: surface });
    d.setGeometry(a, { x: -100, y: 0, w: 100, h: 60 });
    const b = d.insertBlock("shape", { variant: "rect" }, { parent: surface });
    d.setGeometry(b, { x: 100, y: 0, w: 100, h: 60 });
    d.insertBlock("connector", { start: { blockId: a }, end: { blockId: b } }, { parent: surface });
    const doc = renderCanvas(d);
    const connector = "z0004";
    // The new connector stands on top (max + 1): the DOM order's tail,
    // over both figures.
    expect(canvasItemIds()).toEqual(["z0002", "z0003", connector]);
    expect(zIndexOf(doc, connector)).toBe(3);
    // The line stands inside its own wrapper (the per-line svg), so the
    // interleaving stands over the real line, not a placeholder.
    const wrapper = document.querySelector<HTMLElement>(
      `[data-slot="docblocks/canvas-item"][data-block-id="${connector}"]`
    );
    expect(wrapper).not.toBeNull();
    expect(wrapper?.querySelector(`[data-connector-id="${connector}"]`)).not.toBeNull();

    act(() => {
      doc.setZOrder(connector, "toBack");
    });
    // The connector moves under both figures: the DOM order's head, the
    // line renders below the shapes (the former single overlay painted
    // every line on top).
    expect(doc.getChildren("z0001")).toEqual([connector, "z0002", "z0003"]);
    expect(canvasItemIds()).toEqual([connector, "z0002", "z0003"]);
    expect(zIndexOf(doc, connector)).toBe(1);
    expect(zIndexOf(doc, "z0002")).toBe(2);
    expect(zIndexOf(doc, "z0003")).toBe(3);
    // The line stands still (the interactive stand is unchanged by the z
    // reorder — the hit path stands).
    const line = document.querySelector<SVGPathElement>(`[data-connector-id="${connector}"]`);
    expect(line).not.toBeNull();
    expect(document.querySelector(`[data-connector-hit="${connector}"]`)).not.toBeNull();
  });

  it("a new figure stands on top (the DOM tail)", () => {
    const d = newDoc();
    const surface = d.insertBlock("surface");
    d.insertBlock("shape", { variant: "rect" }, { parent: surface });
    d.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
    const doc = renderCanvas(d);
    expect(canvasItemIds()).toEqual(["z0002", "z0003"]);
    let created = "";
    act(() => {
      created = doc.insertBlock("shape", { variant: "rect" }, { parent: "z0001" });
    });
    // max + 1: the new figure is the last in the paint order.
    expect(doc.getChildren("z0001")).toEqual(["z0002", "z0003", created]);
    expect(canvasItemIds()).toEqual(["z0002", "z0003", created]);
    expect(zIndexOf(doc, created)).toBe(3);
  });

  it("the legacy form (no zIndex) stands the children order (the lenient fallback)", () => {
    // The pre-release shape (the surface's canvas elements stand no
    // zIndex): the strict read accepts it (the all-or-nothing invariant),
    // the render stands the children order.
    const doc = fromJSON({
      v: 1,
      id: "legacy",
      title: "",
      createdAt: CREATED_AT,
      blocks: {
        legacy: { type: "root", children: ["s1"] },
        s1: { type: "surface", children: ["a", "b"] },
        a: { type: "shape", attrs: { variant: "rect" }, geometry: { x: -100, y: 0, w: 80, h: 60 } },
        b: { type: "shape", attrs: { variant: "ellipse" }, geometry: { x: 100, y: 0, w: 80, h: 60 } },
      },
    });
    renderCanvas(doc);
    expect(canvasItemIds()).toEqual(["a", "b"]);
    expect(zIndexOf(doc, "a")).toBe(-1);
    expect(zIndexOf(doc, "b")).toBe(-1);
  });

  it("the page view stands the same order with the inert line", () => {
    const d = newDoc();
    const surface = d.insertBlock("surface");
    const a = d.insertBlock("shape", { variant: "rect" }, { parent: surface });
    d.setGeometry(a, { x: -100, y: 0, w: 100, h: 60 });
    const b = d.insertBlock("shape", { variant: "rect" }, { parent: surface });
    d.setGeometry(b, { x: 100, y: 0, w: 100, h: 60 });
    d.insertBlock("connector", { start: { blockId: a }, end: { blockId: b } }, { parent: surface });
    renderCanvas(d, "page");
    // The children order's paint stand (the connector on top).
    expect(canvasItemIds()).toEqual(["z0002", "z0003", "z0004"]);
    // The line stands (the display stand), the hit path stands off (the
    // page view is not selectable — the band must not intercept the
    // content's clicks).
    expect(document.querySelector('[data-connector-id="z0004"]')).not.toBeNull();
    expect(document.querySelector('[data-connector-hit="z0004"]')).toBeNull();
  });
});
