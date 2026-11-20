// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import type { BlockRendererMap } from "../src/blocks/renderers";
import { EditorProvider } from "../src/editor-provider";
import { CREATED_AT, IDS, canvasItemIds, renderScene, seedStrayShape } from "./canvas-scene";

afterEach(cleanup);

describe("canvas scene: the render", () => {
  it("renders the surface container with the elements in z-order (DOM order)", () => {
    renderScene({ view: "canvas" });
    // The scene renders ONLY in the canvas view (the page view filters the
    // surface out of the sequence), so the container's stand is the
    // canvas-view's world.
    expect(document.querySelector('[data-slot="docblocks/canvas-world"]')).not.toBeNull();
    // The container's focus is the hotkey's parking stand (the keys'
    // reach) — it stands no visible ring of its own (a canvas-wide focus
    // frame is noise; the items' own outlines stand the feedback).
    const view = document.querySelector<HTMLElement>('[data-slot="docblocks/canvas-view"]');
    expect(view).not.toBeNull();
    expect(view!.className).not.toContain("focus-visible:ring");
    // The paint order is the children's order over every canvas type (the
    // frame stands its data's slot — the middle's place, no view-back's
    // pin).
    expect(canvasItemIds()).toEqual([
      IDS.rect,
      IDS.ellipse,
      IDS.text,
      IDS.connector,
      IDS.brokenConnector,
      IDS.frame,
      IDS.docIdConnector,
      IDS.pointsConnector,
    ]);
  });

  it("reorders the elements on a moveBlock within the surface (the z-order change)", () => {
    const doc = renderScene({ view: "canvas" });
    // Move the rect (index 0) to the end of the surface's children
    // (pre-move index semantics: toIndex = the current last position + 1).
    act(() => {
      doc.moveBlock(IDS.rect, IDS.surface, 8);
    });
    // The DOM order stands the children's order (the rect's move to the
    // tail, the rest's parity — the frame over its slot).
    expect(canvasItemIds()).toEqual([
      IDS.ellipse,
      IDS.text,
      IDS.connector,
      IDS.brokenConnector,
      IDS.frame,
      IDS.docIdConnector,
      IDS.pointsConnector,
      IDS.rect,
    ]);
  });

  it("positions the elements by geometry (the center-anchor coordinate model)", () => {
    renderScene({ view: "canvas" });
    const rect = document.querySelector<HTMLElement>(
      `[data-slot="docblocks/canvas-item"][data-block-id="${IDS.rect}"]`
    )!;
    // The center-anchor model: the wrapper is placed at (center + x,
    // center + y) and centered over the point (jsdom normalizes the
    // negative offset inside the calc).
    expect(rect.style.left).toBe("calc(50% - 100px)");
    expect(rect.style.top).toBe("calc(50% - 40px)");
    expect(rect.style.width).toBe("120px");
    expect(rect.style.height).toBe("80px");
    expect(rect.style.transform).toBe("translate(-50%, -50%)");
  });

  it("renders the shapes as SVGs (the variant figures, the dash style, the fill attr)", () => {
    renderScene({ view: "canvas" });
    const rect = document.querySelector<SVGElement>(`[data-slot="docblocks/shape"][data-block-id="${IDS.rect}"]`)!;
    expect(rect.getAttribute("data-variant")).toBe("rect");
    expect(rect.querySelector("rect")).not.toBeNull();
    expect(rect.querySelector("ellipse")).toBeNull();
    // The fill attr is a data-driven presentation attribute.
    expect(rect.querySelector("g")!.getAttribute("fill")).toBe("rgba(9, 105, 218, 0.2)");

    const ellipse = document.querySelector<SVGElement>(
      `[data-slot="docblocks/shape"][data-block-id="${IDS.ellipse}"]`
    )!;
    expect(ellipse.querySelector("ellipse")).not.toBeNull();
    expect(ellipse.querySelector("g")!.getAttribute("stroke-dasharray")).toBe("8 4");
  });

  it("renders the canvas-text as an editable block with the font attrs as inline styles", () => {
    renderScene({ view: "canvas" });
    // The original's wrapper over the world's direct children (the frame's
    // window's copy stands inside the frame's wrapper — the z-order's
    // direct-children' stand).
    const world = document.querySelector<HTMLElement>('[data-slot="docblocks/canvas-world"]')!;
    const wrapper = world.querySelector<HTMLElement>(
      `:scope > [data-slot="docblocks/canvas-item"][data-block-id="${IDS.text}"]`
    )!;
    expect(wrapper.style.fontSize).toBe("20px");
    expect(wrapper.style.textAlign).toBe("center");
    // The text stands once (the original — the canvas frame is a region
    // marker, no content copy). The inner's stand is the rest (the edit
    // session's open over the double-click's entry stands the editable —
    // the press's contract: the single click stands the selection, no
    // caret).
    expect(screen.getAllByText("Canvas text").length).toBe(1);
    const editable = wrapper.querySelector<HTMLElement>(
      `[data-slot="docblocks/block-content"][data-block-id="${IDS.text}"]`
    )!;
    expect(editable.getAttribute("contenteditable")).toBe("false");
  });
});

describe("canvas: consumer renderer", () => {
  it("wins over the built-in canvas renderers (shape and canvas-text)", () => {
    const renderers: BlockRendererMap = {
      shape: ({ id }) => <span data-custom="shape">{`custom-shape-${id}`}</span>,
      "canvas-text": ({ id }) => <span data-custom="canvas-text">{`custom-text-${id}`}</span>,
    };
    renderScene({ view: "canvas", blockRenderers: renderers });
    // The built-in shape SVGs are gone; the custom ones render in place.
    expect(document.querySelector("[data-slot='docblocks/shape']")).toBeNull();
    expect(document.querySelector("[data-custom='shape']")!.textContent).toBe(`custom-shape-${IDS.rect}`);
    expect(document.querySelector("[data-custom='canvas-text']")!.textContent).toBe(`custom-text-${IDS.text}`);
  });
});

describe("canvas: lenient render", () => {
  it("renders a stray shape at the page root as the placeholder (the unknown-kind posture)", () => {
    const doc = createDoc({ id: "outer", createdAt: CREATED_AT });
    doc.transact(() => {
      const p = doc.insertBlock("paragraph");
      doc.insertText(p, 0, "Outer paragraph");
      seedStrayShape(doc);
    });
    render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    expect(document.querySelector('[data-slot="docblocks/placeholder"][data-block-type="shape"]')).not.toBeNull();
    expect(screen.getByText("Outer paragraph")).not.toBeNull();
  });

  it("keeps a shape without a geometry at the center with the default size", () => {
    const doc = createDoc({ id: "outer", createdAt: CREATED_AT });
    doc.transact(() => {
      const surface = doc.insertBlock("surface");
      doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    });
    render(
      <EditorProvider doc={doc}>
        <Editor view="canvas" />
      </EditorProvider>
    );
    const wrapper = document.querySelector<HTMLElement>("[data-slot='docblocks/canvas-item']")!;
    expect(wrapper.style.left).toBe("calc(50% + 0px)");
    expect(wrapper.style.top).toBe("calc(50% + 0px)");
    expect(wrapper.style.width).toBe("100px");
    expect(wrapper.style.height).toBe("100px");
  });
});
