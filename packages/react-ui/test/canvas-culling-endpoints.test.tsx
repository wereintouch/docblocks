// @vitest-environment jsdom
// The culling's keep set's stand over the SURFACE LAYER (the off-viewport
// items' DOM stand): the keep set thins the RENDERED wrappers only — the
// surface's siblings' block context stands the surface's FULL children
// list, so the connector's endpoint resolution stands the off-viewport
// (culled) endpoint blocks over their committed geometry. The line with a
// culled endpoint stands drawn (no data-missing, the path's d stands),
// and the culled wrapper stands off (the culling's own stand intact).
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { Block, BlockId } from "docblocks-core";

import { SurfaceLayer } from "../src/canvas/canvas-view/SurfaceLayer";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

/** The surface's seeded stand: two far-apart shapes (the 5000px gap —
 * wider than any viewport + the cull margin, the off-viewport endpoint's
 * repro's stand) over the connector's line. */
function seededDoc(): { doc: TestDoc; surfaceId: BlockId; a: BlockId; b: BlockId; line: BlockId } {
  const doc = createDoc({ id: "culling-endpoints-doc", createdAt: CREATED_AT });
  doc.transact(() => {
    const surface = doc.insertBlock("surface");
    const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    doc.setGeometry(a, { x: 0, y: 0, w: 100, h: 60 });
    const b = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    doc.setGeometry(b, { x: 5000, y: 0, w: 100, h: 60 });
    doc.insertBlock("connector", { start: { blockId: a }, end: { blockId: b } }, { parent: surface });
  });
  const json = doc.toJSON();
  const surfaceId = Object.keys(json.blocks).find((id) => json.blocks[id]?.type === "surface")!;
  const ids = doc.getChildren(surfaceId);
  const block = (id: BlockId): Block => json.blocks[id] as Block;
  const a = ids.find((id) => block(id).type === "shape" && block(id).geometry?.x === 0)!;
  const b = ids.find((id) => block(id).type === "shape" && block(id).geometry?.x === 5000)!;
  const line = ids.find((id) => block(id).type === "connector")!;
  return { doc, surfaceId, a, b, line };
}

function renderLayer(doc: TestDoc, surfaceId: BlockId, ids: BlockId[], visibleIds?: Set<BlockId> | null) {
  return render(
    <EditorProvider doc={doc}>
      <SurfaceLayer id={surfaceId} children={ids} visibleIds={visibleIds} pendingConnector={null} />
    </EditorProvider>
  );
}

afterEach(cleanup);

describe("the surface layer's culling's keep set (the endpoint's resolution's stand)", () => {
  it("the culled endpoint's line stands drawn (the data-missing's drop stands off)", () => {
    const { doc, surfaceId, a, b, line } = seededDoc();
    const { container } = renderLayer(doc, surfaceId, [a, b, line], new Set([a, line]));
    // The endpoint's b stands out of the keep set: no wrapper of its own
    // (the culling's own stand intact).
    expect(container.querySelector(`[data-block-id="${b}"]`)).toBeNull();
    // The line's wrapper stands (its cull box's stand — over both
    // endpoints' boxes), and the line stands DRAWN: the endpoint's b
    // resolves over the committed geometry (the full children's context),
    // not over the keep set.
    const item = container.querySelector(`[data-block-id="${line}"]`);
    expect(item).not.toBeNull();
    expect(item!.hasAttribute("data-missing")).toBe(false);
    const path = container.querySelector<SVGPathElement>(`[data-connector-id="${line}"]`);
    expect(path).not.toBeNull();
    expect(path!.getAttribute("d")).toMatch(/^M /);
  });

  it("both endpoints culled — the line stands drawn over the committed geometry", () => {
    const { doc, surfaceId, a, b, line } = seededDoc();
    const { container } = renderLayer(doc, surfaceId, [a, b, line], new Set([line]));
    expect(container.querySelector(`[data-block-id="${a}"]`)).toBeNull();
    expect(container.querySelector(`[data-block-id="${b}"]`)).toBeNull();
    const item = container.querySelector(`[data-block-id="${line}"]`);
    expect(item).not.toBeNull();
    expect(item!.hasAttribute("data-missing")).toBe(false);
    const path = container.querySelector<SVGPathElement>(`[data-connector-id="${line}"]`);
    expect(path).not.toBeNull();
    expect(path!.getAttribute("d")).toMatch(/^M /);
  });

  it("the no-cull's stand (the keep set's null) — every wrapper stands", () => {
    const { doc, surfaceId, a, b, line } = seededDoc();
    const { container } = renderLayer(doc, surfaceId, [a, b, line]);
    for (const id of [a, b, line]) {
      expect(container.querySelector(`[data-block-id="${id}"]`)).not.toBeNull();
    }
  });
});
