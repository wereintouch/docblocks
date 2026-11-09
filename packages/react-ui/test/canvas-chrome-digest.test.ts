import { describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { flatStructureKey } from "../src/blocks/flat";
import { surfaceChromeKey } from "../src/canvas/geometry";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

describe("the canvas chrome digest (the re-render contract's key)", () => {
  it("stands over a text-only change (the geometry and the chrome attrs stand)", () => {
    const doc = createDoc({ id: "chrome-digest", createdAt: CREATED_AT });
    const page = doc.insertBlock("paragraph");
    doc.insertText(page, 0, "page text");
    const surface = doc.insertBlock("surface");
    const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    doc.setGeometry(a, { x: -100, y: -50, w: 200, h: 100 });
    const conn = doc.insertBlock(
      "connector",
      { start: { blockId: a }, end: { x: 50, y: 0 } },
      {
        parent: surface,
      }
    );

    const blocksBefore = doc.toJSON().blocks;
    const keyBefore = surfaceChromeKey(blocksBefore, doc.getChildren(surface));
    doc.insertText(page, 9, "x"); // a keystroke in the page — the doc's change, the surface's chrome stands
    const blocksAfter = doc.toJSON().blocks;
    expect(surfaceChromeKey(blocksAfter, doc.getChildren(surface))).toBe(keyBefore);
    // The connector's own attrs stand untouched too.
    expect(conn).toBeDefined();
  });

  it("stands over a geometry change", () => {
    const doc = createDoc({ id: "chrome-digest-geo", createdAt: CREATED_AT });
    const surface = doc.insertBlock("surface");
    const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    doc.setGeometry(a, { x: -100, y: -50, w: 200, h: 100 });

    const keyBefore = surfaceChromeKey(doc.toJSON().blocks, doc.getChildren(surface));
    doc.setGeometry(a, { x: 0, y: -50, w: 200, h: 100 });
    const keyAfter = surfaceChromeKey(doc.toJSON().blocks, doc.getChildren(surface));
    expect(keyAfter).not.toBe(keyBefore);
  });

  it("stands over the connector's chrome attrs (the label / the stroke / the endpoints)", () => {
    const doc = createDoc({ id: "chrome-digest-attrs", createdAt: CREATED_AT });
    const surface = doc.insertBlock("surface");
    const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    doc.setGeometry(a, { x: -100, y: -50, w: 200, h: 100 });
    const conn = doc.insertBlock("connector", { start: { blockId: a }, end: { x: 50, y: 0 } }, { parent: surface });

    const keyBefore = surfaceChromeKey(doc.toJSON().blocks, doc.getChildren(surface));
    doc.updateBlock(conn, { label: "moved" });
    expect(surfaceChromeKey(doc.toJSON().blocks, doc.getChildren(surface))).not.toBe(keyBefore);
  });

  it("stands over a group's derived box (the member's move over the group's own stored geometry)", () => {
    const doc = createDoc({ id: "chrome-digest-group", createdAt: CREATED_AT });
    const surface = doc.insertBlock("surface");
    const m = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    doc.setGeometry(m, { x: 0, y: 0, w: 40, h: 40 });
    doc.insertBlock("group", { members: [m] }, { parent: surface });

    const keyBefore = surfaceChromeKey(doc.toJSON().blocks, doc.getChildren(surface));
    doc.setGeometry(m, { x: 200, y: 200, w: 40, h: 40 }); // the member leaves the group's stored union
    const keyAfter = surfaceChromeKey(doc.toJSON().blocks, doc.getChildren(surface));
    expect(keyAfter).not.toBe(keyBefore);
  });

  it("stands over a child's removal (the missing child stands its own entry)", () => {
    const doc = createDoc({ id: "chrome-digest-remove", createdAt: CREATED_AT });
    const surface = doc.insertBlock("surface");
    const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    doc.setGeometry(a, { x: -100, y: -50, w: 200, h: 100 });

    const keyBefore = surfaceChromeKey(doc.toJSON().blocks, doc.getChildren(surface));
    doc.removeBlock(a);
    const keyAfter = surfaceChromeKey(doc.toJSON().blocks, doc.getChildren(surface));
    expect(keyAfter).not.toBe(keyBefore);
  });
});

describe("the flat structure digest (the page sequence's derivation key)", () => {
  it("stands over a text-only change (the indents and the list kinds stand)", () => {
    const doc = createDoc({ id: "flat-digest", createdAt: CREATED_AT });
    const p1 = doc.insertBlock("paragraph");
    doc.insertText(p1, 0, "one");
    const li = doc.insertBlock("list-item", { list: "bullet" });
    doc.insertText(li, 0, "item");

    const ids = doc.getChildren(doc.meta.id);
    const keyBefore = flatStructureKey(ids, doc.toJSON().blocks);
    doc.insertText(p1, 3, " more");
    expect(flatStructureKey(doc.getChildren(doc.meta.id), doc.toJSON().blocks)).toBe(keyBefore);
  });

  it("stands over an indent change", () => {
    const doc = createDoc({ id: "flat-digest-indent", createdAt: CREATED_AT });
    const p1 = doc.insertBlock("paragraph");
    doc.insertText(p1, 0, "one");
    const p2 = doc.insertBlock("paragraph");
    doc.insertText(p2, 0, "two");

    const keyBefore = flatStructureKey(doc.getChildren(doc.meta.id), doc.toJSON().blocks);
    doc.updateBlock(p2, { indent: 1 });
    expect(flatStructureKey(doc.getChildren(doc.meta.id), doc.toJSON().blocks)).not.toBe(keyBefore);
  });

  it("stands over a list-kind change", () => {
    const doc = createDoc({ id: "flat-digest-list", createdAt: CREATED_AT });
    const li = doc.insertBlock("list-item", { list: "bullet" });
    doc.insertText(li, 0, "item");

    const keyBefore = flatStructureKey(doc.getChildren(doc.meta.id), doc.toJSON().blocks);
    doc.updateBlock(li, { list: "number" });
    expect(flatStructureKey(doc.getChildren(doc.meta.id), doc.toJSON().blocks)).not.toBe(keyBefore);
  });
});
