// The canvas clipboard's deep copy (copyCanvasItems): the deep data's copy
// (attrs / text / geometry; the frame's exclusion, the container's members'
// ride), the canvas-text's runs' marks, the group's transitive members, and
// the copy's stands (the frame-only / the empty selection, the page block).
import { describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId, Doc } from "docblocks-core";

import { copyCanvasItems } from "../src/canvas/clipboard";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

/**
 * The scene: the surface with two shapes (A / B, the union center at the
 * origin), a canvas-text T (the bold runs), a group G over A + B (the own
 * box), a connector C1 A → B (the legacy refs), an external shape E (the
 * connector C2's endpoint — the external ref's remap stand), and a frame F
 * (the copy out).
 */
function scene(): {
  doc: Doc;
  surface: BlockId;
  a: BlockId;
  b: BlockId;
  t: BlockId;
  g: BlockId;
  c1: BlockId;
  c2: BlockId;
  e: BlockId;
  f: BlockId;
} {
  const doc = createDoc({ id: "clipboard-doc", createdAt: CREATED_AT });
  const surface = doc.insertBlock("surface");
  const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
  doc.setGeometry(a, { x: -100, y: 0, w: 50, h: 50 });
  const b = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
  doc.setGeometry(b, { x: 100, y: 0, w: 50, h: 50 });
  const t = doc.insertBlock("canvas-text", undefined, { parent: surface });
  doc.insertText(t, 0, "hello ", {});
  doc.insertText(t, 6, "bold", { bold: true });
  doc.setGeometry(t, { x: 0, y: 100, w: 80, h: 40 });
  const g = doc.insertBlock("group", { members: [a, b] }, { parent: surface });
  doc.setGeometry(g, { x: 0, y: 0, w: 300, h: 100 });
  const c1 = doc.insertBlock("connector", { start: { blockId: a }, end: { blockId: b } }, { parent: surface });
  const e = doc.insertBlock("shape", { variant: "diamond" }, { parent: surface });
  doc.setGeometry(e, { x: 100, y: 200, w: 50, h: 50 });
  const c2 = doc.insertBlock("connector", { start: { blockId: a }, end: { blockId: e } }, { parent: surface });
  const f = doc.insertBlock("frame", undefined, { parent: surface });
  return { doc, surface, a, b, t, g, c1, c2, e, f };
}

describe("copyCanvasItems", () => {
  it("copies the deep data (attrs / text / geometry) and stands the frame out", () => {
    const { doc, a, b, t, g, c1, f } = scene();
    const clip = copyCanvasItems(doc, [a, t, g, c1, f]);
    expect(clip).not.toBeNull();
    // The top-level ids stand the originals (the frame excluded; the
    // group's members ride the copy — the selection's stand is the
    // container's outline, the members stand no top-level id).
    expect(clip!.ids).toEqual([a, t, g, c1]);
    expect(clip!.entries.map((entry) => entry.id)).toEqual([a, t, g, b, c1]);
    // The geometry stands the copy (the original's later edit stands the
    // copy out).
    const aItem = clip!.entries.find((entry) => entry.item.type === "shape" && entry.item.attrs?.variant === "rect");
    expect(aItem?.item.geometry).toEqual({ x: -100, y: 0, w: 50, h: 50 });
    doc.setGeometry(a, { x: 999, y: 999, w: 50, h: 50 });
    expect(aItem?.item.geometry).toEqual({ x: -100, y: 0, w: 50, h: 50 });
  });

  it("copies the canvas-text's runs with the marks", () => {
    const { doc, t } = scene();
    const clip = copyCanvasItems(doc, [t]);
    expect(clip).not.toBeNull();
    const item = clip!.entries[0]!.item;
    if (item.type !== "canvas-text") throw new Error("the canvas-text is missing");
    expect(item.content).toEqual([
      { text: "hello ", marks: {} },
      { text: "bold", marks: { bold: true } },
    ]);
  });

  it("rides the group's transitive members", () => {
    const { doc, g, a, b } = scene();
    const clip = copyCanvasItems(doc, [g]);
    expect(clip).not.toBeNull();
    // The top-level id is the group; the members ride the copy (the
    // visit's order — the members land after the group).
    expect(clip!.ids).toEqual([g]);
    expect(clip!.entries.map((entry) => entry.id)).toEqual([g, a, b]);
  });

  it("stands the copy out over the frame-only / the empty selection", () => {
    const { doc, f } = scene();
    expect(copyCanvasItems(doc, [f])).toBeNull();
    expect(copyCanvasItems(doc, [])).toBeNull();
  });

  it("stands the copy out over the page block (the root's miniature)", () => {
    const { doc } = scene();
    const page = doc.insertBlock("paragraph");
    expect(copyCanvasItems(doc, [page, doc.meta.id])).toBeNull();
  });
});
