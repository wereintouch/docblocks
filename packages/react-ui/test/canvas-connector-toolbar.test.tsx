// @vitest-environment jsdom
// The connector's type toolbar (the single `connector` selection): the
// render conditions (the single connector stands it; the multi selection,
// the non-connector blocks, and the active tool hide it) and the applies
// (one updateBlock per pick, one undo step; the doc stays valid).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc, validateDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/EditorProvider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

function newDoc(): TestDoc {
  return createDoc({ id: "connector-type-doc", createdAt: CREATED_AT });
}

function seededDoc(): { doc: TestDoc; connector: BlockId; shape: BlockId } {
  const doc = newDoc();
  doc.transact(() => {
    const surface = doc.insertBlock("surface");
    const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    doc.setGeometry(a, { x: -200, y: 0, w: 100, h: 60 });
    const b = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    doc.setGeometry(b, { x: 200, y: 0, w: 100, h: 60 });
    const connector = doc.insertBlock(
      "connector",
      { start: { blockId: a }, end: { blockId: b } },
      {
        parent: surface,
      }
    );
    return { connector, shape: a };
  });
  // The transact's return: read the ids back (the deterministic order).
  const json = doc.toJSON();
  const surfaceId = Object.keys(json.blocks).find((id) => json.blocks[id]?.type === "surface")!;
  const ids = doc.getChildren(surfaceId);
  const shape = ids.find((id) => json.blocks[id]?.type === "shape")!;
  const connector = ids.find((id) => json.blocks[id]?.type === "connector")!;
  return { doc, connector, shape };
}

function renderCanvas(doc: TestDoc) {
  const utils = render(
    <EditorProvider doc={doc}>
      <Editor view="canvas" />
    </EditorProvider>
  );
  const view = utils.container.querySelector('[data-slot="docblocks/canvas-view"]');
  if (view === null) throw new Error("the canvas view is missing");
  return { ...utils, view };
}

const toolbar = () => screen.queryByRole("toolbar", { name: "Connector type" });

/** Click-select the block (the pointerdown on its canvas-item / hit-path). */
function selectBlock(container: HTMLElement, id: string, viaHitPath = false): void {
  const selector = viaHitPath
    ? `[data-connector-hit="${id}"]`
    : `[data-slot="docblocks/canvas-item"][data-block-id="${id}"]`;
  const target = container.querySelector<HTMLElement>(selector);
  if (target === null) throw new Error(`the ${viaHitPath ? "hit path" : "canvas item"} ${id} is missing`);
  fireEvent.pointerDown(target, { clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerUp(target, { pointerId: 1 });
}

function variantOf(doc: TestDoc, id: string): string | undefined {
  const block = doc.getBlock(id);
  if (block === null || block.type !== "connector") return undefined;
  return block.attrs?.variant;
}

describe("the render conditions", () => {
  it("stands the toolbar for a single connector selection", () => {
    const { doc, connector } = seededDoc();
    const { view } = renderCanvas(doc);
    expect(toolbar()).toBeNull();

    selectBlock(view as HTMLElement, connector, true);
    expect(toolbar()).toBeTruthy();
    expect(document.querySelector('[data-slot="docblocks/connector-toolbar-straight"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="docblocks/connector-toolbar-orthogonal"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="docblocks/connector-toolbar-curved"]')).not.toBeNull();
    // The absent variant: no pressed option (the default stands straight).
    const pressed = document.querySelectorAll('[data-slot^="docblocks/connector-toolbar-"][aria-pressed="true"]');
    expect(pressed.length).toBe(0);
  });

  it("hides the toolbar for a shape selection (the shape toolbar stands instead)", () => {
    const { doc, shape } = seededDoc();
    const { view } = renderCanvas(doc);
    selectBlock(view as HTMLElement, shape);
    expect(toolbar()).toBeNull();
    expect(screen.queryByRole("toolbar", { name: "Shape colors" })).toBeTruthy();
  });

  it("hides the toolbar for the multi selection", () => {
    const { doc, connector, shape } = seededDoc();
    const { view } = renderCanvas(doc);
    selectBlock(view as HTMLElement, connector, true);
    expect(toolbar()).toBeTruthy();

    // The shape's press moves the selection over (the connectors are
    // click-only selectable — a connector joins no group in v1): the
    // toolbar follows the selection and hides.
    selectBlock(view as HTMLElement, shape);
    const shapeSel = (view as HTMLElement).querySelector<HTMLElement>(
      `[data-slot="docblocks/canvas-item"][data-block-id="${shape}"]`
    );
    expect(shapeSel?.hasAttribute("data-selected")).toBe(true);
    expect(toolbar()).toBeNull();
  });
});

describe("the applies", () => {
  it("the orthogonal pick applies the variant (one undo step, the doc stays valid)", () => {
    const { doc, connector } = seededDoc();
    const { view } = renderCanvas(doc);
    selectBlock(view as HTMLElement, connector, true);

    fireEvent.click(screen.getByLabelText("Orthogonal line"));
    expect(variantOf(doc, connector)).toBe("orthogonal");
    expect(validateDoc(doc.toJSON())).toEqual([]);

    // One undo step: the variant patch reverts (one transact).
    doc.undo();
    expect(variantOf(doc, connector)).toBeUndefined();
  });

  it("the curved pick applies and the current option stands pressed", () => {
    const { doc, connector } = seededDoc();
    const { view } = renderCanvas(doc);
    selectBlock(view as HTMLElement, connector, true);

    fireEvent.click(screen.getByLabelText("Curved line"));
    expect(variantOf(doc, connector)).toBe("curved");
    const curved = document.querySelector('[data-slot="docblocks/connector-toolbar-curved"]');
    expect(curved?.getAttribute("aria-pressed")).toBe("true");
    const straight = document.querySelector('[data-slot="docblocks/connector-toolbar-straight"]');
    expect(straight?.getAttribute("aria-pressed")).toBe("false");
  });
});

afterEach(cleanup);
