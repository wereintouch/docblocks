// @vitest-environment jsdom
// The canvas's world-space strokes' min-screen stand (the 1/zoom's
// compensation): the line / the shape's border stands at least 1 screen-px
// wide over the zoom's < 1 (the CSS `max()` over the world's inverse-zoom's
// variable — the zoom's < 1 compensates, the zoom's >= 1 stands the data's
// verbatim). The data's stand stands the attribute (the stroke-width attr —
// the render's compensation is the style, the attribute's parity is
// kept); the world's container carries the inverse-zoom's variable (the
// `max()`'s read over the zoom's flip).
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { minScreenStrokeOf } from "../src/canvas/canvas-stroke";
import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

function seededDoc(): { doc: TestDoc; connector: BlockId } {
  const doc = createDoc({ id: "min-stroke-doc", createdAt: CREATED_AT });
  doc.transact(() => {
    const surface = doc.insertBlock("surface");
    const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    doc.setGeometry(a, { x: -100, y: 0, w: 100, h: 60 });
    const b = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    doc.setGeometry(b, { x: 100, y: 0, w: 100, h: 60 });
    doc.insertBlock("connector", { start: { blockId: a }, end: { blockId: b } }, { parent: surface });
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
  const view = utils.container.querySelector('[data-slot="docblocks/canvas-view"]');
  if (view === null) throw new Error("the canvas view is missing");
  return { ...utils, view };
}

afterEach(cleanup);

describe("the min-screen stroke's stand (the 1/zoom's compensation)", () => {
  it("the helper's stand: the data's width over the 1/zoom's max()", () => {
    expect(minScreenStrokeOf(1)).toBe("max(1px, calc(var(--docblocks-canvas-inv-zoom, 1) * 1px))");
    expect(minScreenStrokeOf(4)).toBe("max(4px, calc(var(--docblocks-canvas-inv-zoom, 1) * 1px))");
  });

  it("the world's container carries the inverse-zoom's variable; the line / the shape's border read it over the max() (the attribute's data parity stands)", () => {
    const { doc, connector } = seededDoc();
    const { view } = renderCanvas(doc);
    const world = view.querySelector<HTMLElement>('[data-slot="docblocks/canvas-world"]');
    expect(world).not.toBeNull();
    expect(world!.getAttribute("style")).toContain("--docblocks-canvas-inv-zoom");

    // The line: the data's stand (the attribute) + the render's
    // compensation (the style's max()).
    const path = view.querySelector<SVGPathElement>(`[data-connector-id="${connector}"]`);
    expect(path).not.toBeNull();
    expect(path!.getAttribute("stroke-width")).toBe("1");
    expect(path!.style.strokeWidth).toBe(minScreenStrokeOf(1));

    // The shape's border (the 2px default's stand): the same stand over
    // its figure's group.
    const shapeG = view.querySelector<SVGElement>('[data-slot="docblocks/shape"] > g');
    expect(shapeG).not.toBeNull();
    expect(shapeG!.getAttribute("stroke-width")).toBe("2");
    expect(shapeG!.style.strokeWidth).toBe(minScreenStrokeOf(2));
  });
});
