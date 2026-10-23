// The canvas clipboard: the deep copy of
// the copied canvas items (the frame excluded, the container's members
// ride) and the paste (the union center at the pointer, the ids remap —
// the container's membership and the connector's endpoints internal → the
// copy, external → the free points at the offset position; one transact
// — one undo step, one wire update).
import { describe, expect, it } from "vitest";

import { createDoc, validateDoc } from "docblocks-core";
import type { BlockId, Doc } from "docblocks-core";

import { copyCanvasItems, pasteCanvasItems } from "../src/canvas/clipboard";

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

/** The shape's variant over an arbitrary id (the typed narrow). */
function variantOf(doc: Doc, id: BlockId): string | undefined {
  const block = doc.getBlock(id);
  return block?.type === "shape" ? block.attrs?.variant : undefined;
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

describe("pasteCanvasItems", () => {
  it("seats the copy's union center at the pointer (the delta over every item)", () => {
    const { doc, surface, a, b } = scene();
    const clip = copyCanvasItems(doc, [a, b]);
    expect(clip).not.toBeNull();
    // The union: x ∈ [-125, 125], y ∈ [-25, 25] → the center at (0, 0);
    // the pointer at (300, 200) → the delta (300, 200).
    const pasted = pasteCanvasItems(doc, clip!, surface, { x: 300, y: 200 });
    expect(pasted).not.toBeNull();
    expect(pasted).toHaveLength(2);
    const aCopy = pasted!.find((id) => variantOf(doc, id) === "rect")!;
    const bCopy = pasted!.find((id) => variantOf(doc, id) === "ellipse")!;
    expect(doc.getBlock(aCopy)?.geometry).toEqual({ x: 200, y: 200, w: 50, h: 50 });
    expect(doc.getBlock(bCopy)?.geometry).toEqual({ x: 400, y: 200, w: 50, h: 50 });
    // The z-order: the paste stands the surface's children's tail.
    expect(doc.getChildren(surface).slice(-2)).toEqual([aCopy, bCopy]);
  });

  it("is one undo step (the undo drops the whole copy, the redo restores it)", () => {
    const { doc, surface, a, b, c1 } = scene();
    const clip = copyCanvasItems(doc, [a, b, c1]);
    expect(clip).not.toBeNull();
    const pasted = pasteCanvasItems(doc, clip!, surface, { x: 500, y: 0 });
    expect(pasted).not.toBeNull();
    expect(pasted).toHaveLength(3);
    for (const id of pasted!) expect(doc.getBlock(id)).not.toBeNull();
    doc.undo();
    for (const id of pasted!) expect(doc.getBlock(id)).toBeNull();
    doc.redo();
    for (const id of pasted!) expect(doc.getBlock(id)).not.toBeNull();
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("remaps the connector's internal endpoints (the copy's ids, the ref's details stand)", () => {
    const { doc, surface, a, b, c1 } = scene();
    const clip = copyCanvasItems(doc, [a, b, c1]);
    expect(clip).not.toBeNull();
    const pasted = pasteCanvasItems(doc, clip!, surface, { x: 300, y: 300 });
    expect(pasted).not.toBeNull();
    // The connector's copy (the last landed — the phase two).
    const connCopy = pasted!.find((id) => doc.getBlock(id)?.type === "connector")!;
    const conn = doc.getBlock(connCopy)!;
    if (conn.type !== "connector") throw new Error("the connector copy is missing");
    const shapes = pasted!.filter((id) => id !== connCopy);
    const newA = shapes.find((id) => variantOf(doc, id) === "rect")!;
    const newB = shapes.find((id) => variantOf(doc, id) === "ellipse")!;
    expect(conn.attrs.start).toEqual({ blockId: newA });
    expect(conn.attrs.end).toEqual({ blockId: newB });
  });

  it("stands the external endpoint over the free point at the offset position (the frozen side)", () => {
    const { doc, surface, a, c2, e } = scene();
    const clip = copyCanvasItems(doc, [a, c2]);
    expect(clip).not.toBeNull();
    const pasted = pasteCanvasItems(doc, clip!, surface, { x: 300, y: 300 });
    expect(pasted).not.toBeNull();
    const connCopy = pasted!.find((id) => doc.getBlock(id)?.type === "connector")!;
    const conn = doc.getBlock(connCopy)!;
    if (conn.type !== "connector") throw new Error("the connector copy is missing");
    // The start (internal): the copy's id.
    const newA = pasted!.find((id) => id !== connCopy)!;
    expect(conn.attrs.start).toEqual({ blockId: newA });
    // The end (external): the free point at the offset position. The
    // original's resolution: E's box center (100, 200), toward A's center
    // (-100, 0) → the west edge's point (75, 175), the normal (-1, 0) →
    // the frozen side "west"; the union = A's box only (the connector
    // stands no box) → the center (-100, 0); the delta (400, 300) →
    // (475, 475).
    expect(conn.attrs.end).toEqual({ x: 475, y: 475, port: "west" });
    // The external shape E stands the paste out (the original stands).
    expect(doc.getBlock(e)).not.toBeNull();
  });

  it("shifts the free-point endpoint (the frozen direction stands)", () => {
    const { doc } = scene();
    const s = doc.insertBlock("surface");
    const x = doc.insertBlock("shape", { variant: "rect" }, { parent: s });
    doc.setGeometry(x, { x: 0, y: 0, w: 40, h: 40 });
    const conn = doc.insertBlock(
      "connector",
      { start: { blockId: x }, end: { x: 80, y: 10, port: "east" } },
      { parent: s }
    );
    const clip = copyCanvasItems(doc, [x, conn]);
    expect(clip).not.toBeNull();
    const pasted = pasteCanvasItems(doc, clip!, s, { x: 100, y: 0 });
    expect(pasted).not.toBeNull();
    const connCopy = pasted!.find((id) => doc.getBlock(id)?.type === "connector")!;
    const copied = doc.getBlock(connCopy)!;
    if (copied.type !== "connector") throw new Error("the connector copy is missing");
    // The union: x ∈ [-20, 20] (the shape — the connector stands no box)
    // → the center (0, 0). The delta (100, 0).
    expect(copied.attrs.start.blockId).not.toBe(x);
    expect(copied.attrs.end).toEqual({ x: 180, y: 10, port: "east" });
  });

  it("remaps the group's membership onto the copy's ids (the members' geometry shifts)", () => {
    const { doc, surface, g } = scene();
    const clip = copyCanvasItems(doc, [g]);
    expect(clip).not.toBeNull();
    const pasted = pasteCanvasItems(doc, clip!, surface, { x: 0, y: 500 });
    expect(pasted).not.toBeNull();
    const groupCopy = pasted!.find((id) => doc.getBlock(id)?.type === "group")!;
    const group = doc.getBlock(groupCopy)!;
    if (group.type !== "group") throw new Error("the group copy is missing");
    const members = group.attrs.members;
    expect(members).toHaveLength(2);
    for (const memberId of members) {
      const member = doc.getBlock(memberId)!;
      // The members' geometry: the union (the group's box dominates:
      // x ∈ [-150, 150], y ∈ [-50, 50] → the center (0, 0); the delta
      // (0, 500)) → A at (−100, 500), B at (100, 500).
      expect(member.geometry?.y).toBe(500);
    }
    const aCopy = members.find((id) => variantOf(doc, id) === "rect")!;
    expect(doc.getBlock(aCopy)?.geometry).toEqual({ x: -100, y: 500, w: 50, h: 50 });
    // The group's own box shifts.
    expect(group.geometry).toEqual({ x: 0, y: 500, w: 300, h: 100 });
  });

  it("restores the canvas-text's runs with the marks", () => {
    const { doc, surface, t } = scene();
    const clip = copyCanvasItems(doc, [t]);
    expect(clip).not.toBeNull();
    const pasted = pasteCanvasItems(doc, clip!, surface, { x: 0, y: -300 });
    expect(pasted).not.toBeNull();
    const text = doc.getBlock(pasted![0]!);
    expect(text?.type).toBe("canvas-text");
    if (text?.type !== "canvas-text") throw new Error("the canvas-text copy is missing");
    expect(text.content).toEqual([
      { text: "hello ", marks: {} },
      { text: "bold", marks: { bold: true } },
    ]);
    // The union = T's box only → the center (0, 100); the delta (0, -400).
    expect(text?.geometry).toEqual({ x: 0, y: -300, w: 80, h: 40 });
  });

  it("stands the autonomous copy (the original's removal stands the copy)", () => {
    const { doc, surface, a } = scene();
    const clip = copyCanvasItems(doc, [a]);
    expect(clip).not.toBeNull();
    const pasted = pasteCanvasItems(doc, clip!, surface, { x: 400, y: 0 });
    expect(pasted).not.toBeNull();
    doc.removeBlock(a);
    // The copy stands (the autonomous contract).
    expect(doc.getBlock(pasted![0]!)).not.toBeNull();
  });

  it("re-pastes the same clipboard (the fresh ids, the same stand)", () => {
    const { doc, surface, a } = scene();
    const clip = copyCanvasItems(doc, [a]);
    expect(clip).not.toBeNull();
    const first = pasteCanvasItems(doc, clip!, surface, { x: 300, y: 0 });
    const second = pasteCanvasItems(doc, clip!, surface, { x: 600, y: 0 });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second![0]!).not.toBe(first![0]!);
    expect(doc.getBlock(first![0]!)?.geometry).toEqual({ x: 300, y: 0, w: 50, h: 50 });
    expect(doc.getBlock(second![0]!)?.geometry).toEqual({ x: 600, y: 0, w: 50, h: 50 });
  });

  it("drops the frame member from the container's copy (the autonomy stand)", () => {
    const { doc, surface, a, f } = scene();
    const g = doc.insertBlock("group", { members: [a, f] }, { parent: surface });
    doc.setGeometry(g, { x: 0, y: 50, w: 300, h: 200 });
    const clip = copyCanvasItems(doc, [g]);
    expect(clip).not.toBeNull();
    // The frame stands the copy out (the members' ride skips it).
    expect(clip!.entries.map((entry) => entry.id)).toEqual([g, a]);
    const pasted = pasteCanvasItems(doc, clip!, surface, { x: 0, y: 600 });
    expect(pasted).not.toBeNull();
    const groupCopy = pasted!.find((id) => doc.getBlock(id)?.type === "group")!;
    const group = doc.getBlock(groupCopy)!;
    if (group.type !== "group") throw new Error("the group copy is missing");
    // The membership stands the shape's copy only (the original's frame
    // is not referenced — the copy is autonomous). The union (the group's
    // box) center (0, 50) → the delta (0, 550).
    expect(group.attrs.members).toHaveLength(1);
    const aCopy = group.attrs.members[0]!;
    expect(aCopy).not.toBe(a);
    expect(doc.getBlock(aCopy)?.geometry).toEqual({ x: -100, y: 550, w: 50, h: 50 });
  });

  it("stands no paste over the empty clipboard's shape", () => {
    // The empty copy (the frame-only selection) never reaches the paste —
    // the handler's null guard; the paste over the shape-less clipboard
    // stands no items.
    const { doc, surface } = scene();
    const empty = { entries: [], ids: [] as BlockId[] };
    expect(pasteCanvasItems(doc, empty, surface, { x: 0, y: 0 })).toBeNull();
  });
});
