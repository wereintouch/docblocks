// The connector's label's split set's shared stand: the seeded doc (the
// surface's two shapes + the connector), the canvas view's render, the
// label's read, and the line's hit's gesture (the wide hit path's read +
// the line's double-click over the stroke band's point).
import { fireEvent, render } from "@testing-library/react";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";
import { pressPointOf } from "./canvas-press";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

function newDoc(): TestDoc {
  return createDoc({ id: "connector-label-doc", createdAt: CREATED_AT });
}

function seededDoc(): { doc: TestDoc; connector: BlockId } {
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
    return { connector };
  });
  const json = doc.toJSON();
  const surfaceId = Object.keys(json.blocks).find((id) => json.blocks[id]?.type === "surface")!;
  const ids = doc.getChildren(surfaceId);
  const connector = ids.find((id) => json.blocks[id]?.type === "connector")!;
  return { doc, connector };
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

function labelOf(doc: TestDoc, id: string): string | undefined {
  const block = doc.getBlock(id);
  if (block === null || block.type !== "connector") return undefined;
  return block.attrs.label;
}

/** The line's hit path (the wide transparent stroke the line clicks on). */
function hitPath(container: HTMLElement, id: string): SVGPathElement {
  const path = container.querySelector<SVGPathElement>(`[data-connector-hit="${id}"]`);
  if (path === null) throw new Error(`the hit path ${id} is missing`);
  return path;
}

/** The double-click over the line (the label's edit entry stands the
 * resolver's answer over the point — the line's stroke band along its
 * route; the hit path's target keeps the empty-canvas' ghost entry off). */
function dblclickLine(view: HTMLElement, doc: TestDoc, id: string): void {
  const point = pressPointOf(doc, id);
  fireEvent.doubleClick(hitPath(view, id), { clientX: point.x, clientY: point.y });
}

export { dblclickLine, labelOf, renderCanvas, seededDoc };
export type { TestDoc };
