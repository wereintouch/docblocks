// The connector toolbar's tests shared stand: the seeded doc (the
// surface + the two shapes + the connector), the canvas's render, the
// toolbar's read, the block's select (the press over the geometry), the
// variant's / the style's read, and the per-test's setup + cleanup.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";
import { pressBlock } from "./canvas-press";

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
  const view = utils.container.querySelector<HTMLElement>('[data-slot="docblocks/canvas-view"]');
  if (view === null) throw new Error("the canvas view is missing");
  return { ...utils, view };
}

const toolbar = () => screen.queryByRole("toolbar", { name: "Connector options" });

/** Click-select the block (the press over the block's own zone — the
 * resolver's answer over the geometry: the figure's outline band, the
 * line's stroke band over the route). */
function selectBlock(view: HTMLElement, doc: TestDoc, id: string): void {
  pressBlock(view, doc, id);
}

function variantOf(doc: TestDoc, id: string): string | undefined {
  const block = doc.getBlock(id);
  if (block === null || block.type !== "connector") return undefined;
  return block.attrs?.variant;
}

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

export { renderCanvas, seededDoc, selectBlock, toolbar, variantOf };
export type { TestDoc };
