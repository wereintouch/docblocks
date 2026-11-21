// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";
import { pressPointOf } from "./canvas-press";

beforeEach(() => window.localStorage.clear());
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
    const view = container.querySelector<HTMLElement>('[data-slot="docblocks/canvas-view"]');
    const wrapper = container.querySelector<HTMLElement>(`[data-slot="docblocks/canvas-item"][data-block-id="${id}"]`);
    if (view === null || wrapper === null) throw new Error("the canvas view / the item is missing");

    // The stored rotation stands no transform term (the render ignores
    // it): the resting transform is the centering translate only.
    expect(wrapper.style.transform).toBe("translate(-50%, -50%)");

    // The in-flight drag (the press over the block's own zone, the moves
    // on the view — the pointer is captured on the view): the preview
    // stands the canvas-axis offset.
    const p = pressPointOf(doc, id);
    fireEvent.pointerDown(view, { clientX: p.x, clientY: p.y });
    fireEvent.pointerMove(view, { clientX: p.x + 40, clientY: p.y + 20, buttons: 1 });
    expect(wrapper.style.transform).toBe("translate(-50%, -50%) translate(40px, 20px)");

    // The release commits the canvas-axis delta (the commit writes
    // x/y/w/h only; the stored rotation survives the core's merge).
    fireEvent.pointerUp(view);
    expect(doc.getBlock(id)?.geometry).toEqual({ x: 40, y: 20, w: 100, h: 50, rotation: 90 });
  });
});
