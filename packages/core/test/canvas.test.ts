import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { InvalidAttrsError, InvalidChildError, createDoc, fromJSON } from "../src/core";
import type { Doc } from "../src/core";
import type { DocJSON } from "../src/schema";
import { validateDoc } from "../src/schema";

/**
 * The canvas block types (v2, option A: canvas elements are blocks of the
 * SAME document): surface / shape / connector / frame / canvas-text. The
 * validation boundary (the strict validator: the registry-driven enums and
 * bounds + the canvas branch for the points tuples, the connector refs,
 * and the geometry shape; the lenient reader over the raw + applyUpdate
 * path), the z-order semantics (the surface's children order IS the
 * paint order), and the structural rules. setGeometry is geometry.test.ts.
 */

const CREATED_AT = "2026-01-01T00:00:00Z";

const newDoc = (): Doc => createDoc({ id: "r", createdAt: CREATED_AT });

/** The full canvas scene (the strict validator's happy path). */
const canvasDoc = (): DocJSON => ({
  v: 1,
  id: "d1",
  title: "",
  createdAt: CREATED_AT,
  blocks: {
    d1: { type: "root", children: ["s1", "p1"] },
    // A page block with a geometry (the double mode: the block flows in the
    // page view, the geometry is ignored there).
    p1: { type: "paragraph", geometry: { x: 5, y: -5, w: 100, h: 40 }, content: [{ text: "page", marks: {} }] },
    s1: { type: "surface", children: ["f1", "sh1", "sh2", "c1", "t1", "e1"] },
    f1: { type: "frame", children: ["fh1", "fp1"], geometry: { x: -80, y: -40, w: 200, h: 100 } },
    fh1: { type: "heading", attrs: { level: 2 }, content: [{ text: "frame", marks: {} }] },
    fp1: { type: "paragraph", content: [{ text: "inside the frame", marks: {} }] },
    sh1: {
      type: "shape",
      attrs: {
        variant: "rect",
        stroke: "#0969da",
        fill: "rgba(9, 105, 218, 0.2)",
        strokeWidth: 2,
        strokeStyle: "dash",
        opacity: 0.5,
        points: [
          [1, 2],
          [3, 4],
        ],
      },
      geometry: { x: 60, y: 0, w: 80, h: 60 },
    },
    sh2: { type: "shape", attrs: { variant: "rounded" } },
    c1: {
      type: "connector",
      attrs: {
        start: { blockId: "f1" },
        end: { blockId: "sh1" },
        points: [[0, 30]],
        label: "link",
        variant: "orthogonal",
        strokeStyle: "dot",
      },
    },
    // A cross-doc connector ref (docId): valid data; the renderer resolves
    // blockId-only within the surface in v1 (the docId ref is skipped).
    e1: { type: "connector", attrs: { start: { docId: "master-1" }, end: { docId: "master-2", blockId: "b9" } } },
    t1: {
      type: "canvas-text",
      attrs: { fontSize: 14, textAlign: "center" },
      content: [{ text: "canvas", marks: {} }],
    },
  },
});

/** A scene variant: the base scene with one block entry replaced. */
const withBlock = (id: string, block: unknown): DocJSON => {
  const scene = canvasDoc();
  return { ...scene, blocks: { ...scene.blocks, [id]: block as DocJSON["blocks"][string] } };
};

describe("strict validation (validateDoc)", () => {
  it("accepts the full canvas scene", () => {
    expect(validateDoc(canvasDoc())).toEqual([]);
  });

  it("rejects the shape variant enum and the paint bounds (registry-driven)", () => {
    const variant = validateDoc(withBlock("sh1", { type: "shape", attrs: { variant: "hexagon" } }));
    expect(variant.some((e) => e.path === "blocks.sh1.attrs.variant")).toBe(true);
    // The new figure variants stand:
    // the validator's registry carries them, the reader stays lenient
    // over the unknowns (the legacy `line`'s stand).
    expect(validateDoc(withBlock("sh1", { type: "shape", attrs: { variant: "cylinder" } }))).toEqual([]);
    expect(validateDoc(withBlock("sh1", { type: "shape", attrs: { variant: "cloud" } }))).toEqual([]);
    const noVariant = validateDoc(withBlock("sh1", { type: "shape", attrs: {} }));
    expect(noVariant.some((e) => e.path === "blocks.sh1.attrs.variant")).toBe(true);
    const opacity = validateDoc(withBlock("sh1", { type: "shape", attrs: { variant: "rect", opacity: 1.5 } }));
    expect(opacity.some((e) => e.path === "blocks.sh1.attrs.opacity")).toBe(true);
    const negativeOpacity = validateDoc(withBlock("sh1", { type: "shape", attrs: { variant: "rect", opacity: -0.1 } }));
    expect(negativeOpacity.some((e) => e.path === "blocks.sh1.attrs.opacity")).toBe(true);
    const strokeWidth = validateDoc(withBlock("sh1", { type: "shape", attrs: { variant: "rect", strokeWidth: 0 } }));
    expect(strokeWidth.some((e) => e.path === "blocks.sh1.attrs.strokeWidth")).toBe(true);
    const fontSize = validateDoc(withBlock("t1", { type: "canvas-text", attrs: { fontSize: -1 } }));
    expect(fontSize.some((e) => e.path === "blocks.t1.attrs.fontSize")).toBe(true);
  });

  it("accepts the shape's text attrs and rejects their malformed forms (registry-driven)", () => {
    const texted = validateDoc(
      withBlock("sh1", {
        type: "shape",
        attrs: {
          variant: "rounded",
          text: "Привет",
          fontSize: 24,
          fontFamily: "Inter",
          textColor: "#ff0000",
          textStyle: "semibold-italic",
          textAlign: "center",
        },
      })
    );
    expect(texted).toEqual([]);
    const badStyle = validateDoc(withBlock("sh1", { type: "shape", attrs: { variant: "rect", textStyle: "bold" } }));
    expect(badStyle.some((e) => e.path === "blocks.sh1.attrs.textStyle")).toBe(true);
    const badAlign = validateDoc(withBlock("sh1", { type: "shape", attrs: { variant: "rect", textAlign: "justify" } }));
    expect(badAlign.some((e) => e.path === "blocks.sh1.attrs.textAlign")).toBe(true);
    const smallSize = validateDoc(withBlock("sh1", { type: "shape", attrs: { variant: "rect", fontSize: 3 } }));
    expect(smallSize.some((e) => e.path === "blocks.sh1.attrs.fontSize")).toBe(true);
    const notHex = validateDoc(withBlock("sh1", { type: "shape", attrs: { variant: "rect", textColor: "red" } }));
    expect(notHex.some((e) => e.path === "blocks.sh1.attrs.textColor")).toBe(true);
  });

  it("rejects the legacy line variant (the strict reader: the lenient render keeps the figure)", () => {
    const line = validateDoc(withBlock("sh1", { type: "shape", attrs: { variant: "line" } }));
    expect(line.some((e) => e.path === "blocks.sh1.attrs.variant")).toBe(true);
    // The wire path (a peer on an older build) still delivers it: the read
    // keeps the data, the validator flags it.
    const source = newDoc();
    const surface = source.insertBlock("surface");
    const shape = source.insertBlock("shape", { variant: "rect" }, { parent: surface });
    source.raw.transact(() => {
      const block = source.raw.getMap("blocks").get(shape) as Y.Map<unknown>;
      (block.get("attrs") as Y.Map<unknown>).set("variant", "line");
    });
    const target = newDoc();
    target.applyUpdate(source.encode());
    expect(target.getBlock(shape)).toEqual({ type: "shape", attrs: { variant: "line" } });
  });

  it("rejects malformed points tuples (the canvas branch)", () => {
    const triple = validateDoc(withBlock("sh1", { type: "shape", attrs: { variant: "rect", points: [[1, 2, 3]] } }));
    expect(triple.some((e) => e.path === "blocks.sh1.attrs.points[0]")).toBe(true);
    const single = validateDoc(withBlock("sh1", { type: "shape", attrs: { variant: "rect", points: [[1]] } }));
    expect(single.some((e) => e.path === "blocks.sh1.attrs.points[0]")).toBe(true);
    const mixed = validateDoc(
      withBlock("sh1", {
        type: "shape",
        attrs: {
          variant: "rect",
          points: [
            [1, 2],
            [3, "a"],
          ],
        },
      })
    );
    expect(mixed.some((e) => e.path === "blocks.sh1.attrs.points[1]")).toBe(true);
    const nan = validateDoc(withBlock("sh1", { type: "shape", attrs: { variant: "rect", points: [[Number.NaN, 1]] } }));
    expect(nan.some((e) => e.path === "blocks.sh1.attrs.points[0]")).toBe(true);
    // The connector's points get the same tuple check.
    const conn = validateDoc(
      withBlock("c1", {
        type: "connector",
        attrs: { start: { blockId: "f1" }, end: { blockId: "sh1" }, points: [["x"]] },
      })
    );
    expect(conn.some((e) => e.path === "blocks.c1.attrs.points[0]")).toBe(true);
  });

  it("rejects the connector endpoints without a ref or a free point (the canvas branch)", () => {
    const emptyStart = validateDoc(
      withBlock("c1", { type: "connector", attrs: { start: {}, end: { blockId: "sh1" } } })
    );
    expect(emptyStart.some((e) => e.path === "blocks.c1.attrs.start")).toBe(true);
    const emptyEnd = validateDoc(withBlock("c1", { type: "connector", attrs: { start: { blockId: "f1" }, end: {} } }));
    expect(emptyEnd.some((e) => e.path === "blocks.c1.attrs.end")).toBe(true);
    // Unknown fields in a ref stay rejected by the object spec.
    const unknownField = validateDoc(
      withBlock("c1", { type: "connector", attrs: { start: { blockId: "f1", bogus: 1 }, end: { blockId: "sh1" } } })
    );
    expect(unknownField.some((e) => e.path === "blocks.c1.attrs.start.bogus")).toBe(true);
    // The refs are required.
    const noRefs = validateDoc(withBlock("c1", { type: "connector" }));
    expect(noRefs.some((e) => e.path === "blocks.c1.attrs.start")).toBe(true);
    expect(noRefs.some((e) => e.path === "blocks.c1.attrs.end")).toBe(true);
  });

  it("accepts the endpoint shapes (the port on a ref, the free point, the frozen direction) and rejects their malformed forms", () => {
    // A ref + port, a free point, and a free point WITH a port (the
    // frozen direction — the last anchor's side): all valid (2026-10-15 additive).
    const ported = validateDoc(
      withBlock("c1", { type: "connector", attrs: { start: { blockId: "f1", port: "east" }, end: { x: 120, y: -40 } } })
    );
    expect(ported).toEqual([]);
    const frozen = validateDoc(
      withBlock("c1", { type: "connector", attrs: { start: { x: 40, y: 90, port: "south" }, end: { blockId: "sh1" } } })
    );
    expect(frozen).toEqual([]);
    // A port without a ref or a free point is meaningless.
    const portAlone = validateDoc(
      withBlock("c1", { type: "connector", attrs: { start: { port: "north" }, end: { blockId: "sh1" } } })
    );
    expect(portAlone.some((e) => e.path === "blocks.c1.attrs.start")).toBe(true);
    // A free point without both coordinates is incomplete.
    const halfPoint = validateDoc(
      withBlock("c1", { type: "connector", attrs: { start: { x: 10 }, end: { blockId: "sh1" } } })
    );
    expect(halfPoint.some((e) => e.path === "blocks.c1.attrs.start")).toBe(true);
    // The port enum is registry-driven.
    const badPort = validateDoc(
      withBlock("c1", { type: "connector", attrs: { start: { blockId: "f1", port: "up" }, end: { blockId: "sh1" } } })
    );
    expect(badPort.some((e) => e.path === "blocks.c1.attrs.start.port")).toBe(true);
  });

  it("rejects the connector variant enum (registry-driven)", () => {
    const invalid = validateDoc(
      withBlock("c1", {
        type: "connector",
        attrs: { start: { blockId: "f1" }, end: { blockId: "sh1" }, variant: "squiggly" },
      })
    );
    expect(invalid.some((e) => e.path === "blocks.c1.attrs.variant")).toBe(true);
    // The variant is optional: the absent variant stands (the default is
    // the reader/renderer's, not the validator's).
    const absent = validateDoc(
      withBlock("c1", { type: "connector", attrs: { start: { blockId: "f1" }, end: { blockId: "sh1" } } })
    );
    expect(absent.some((e) => e.path === "blocks.c1.attrs.variant")).toBe(false);
  });

  it("checks the connector style attrs (the strokeColor / strokeWidth / arrowHead / arrowStart, registry-driven)", () => {
    const conn = (attrs: Record<string, unknown>) =>
      withBlock("c1", { type: "connector", attrs: { start: { blockId: "f1" }, end: { blockId: "sh1" }, ...attrs } });
    // The width is the 1–4 integer stand.
    const tooThin = validateDoc(conn({ strokeWidth: 0 }));
    expect(tooThin.some((e) => e.path === "blocks.c1.attrs.strokeWidth")).toBe(true);
    const tooThick = validateDoc(conn({ strokeWidth: 5 }));
    expect(tooThick.some((e) => e.path === "blocks.c1.attrs.strokeWidth")).toBe(true);
    const fractional = validateDoc(conn({ strokeWidth: 1.5 }));
    expect(fractional.some((e) => e.path === "blocks.c1.attrs.strokeWidth")).toBe(true);
    // The arrowhead's enum (both ends are figure enums; the start side
    // stands its own figure, the end defaults to "arrow" at render).
    const badHead = validateDoc(conn({ arrowHead: "diamond" }));
    expect(badHead.some((e) => e.path === "blocks.c1.attrs.arrowHead")).toBe(true);
    const badStart = validateDoc(conn({ arrowStart: "yes" }));
    expect(badStart.some((e) => e.path === "blocks.c1.attrs.arrowStart")).toBe(true);
    // The legacy boolean form is rejected by the strict validator (the
    // lenient read maps it — the read's pin below).
    const legacyBoolean = validateDoc(conn({ arrowStart: true }));
    expect(legacyBoolean.some((e) => e.path === "blocks.c1.attrs.arrowStart")).toBe(true);
    // The full set stands (the strict validator is clean).
    const valid = validateDoc(
      conn({ strokeColor: "#ff0000", strokeWidth: 4, arrowHead: "circle", arrowStart: "circle" })
    );
    expect(valid.some((e) => e.path.startsWith("blocks.c1.attrs."))).toBe(false);
  });

  it("checks the edge anchor's portT (the position along the side)", () => {
    const conn = (attrs: Record<string, unknown>) =>
      withBlock("c1", { type: "connector", attrs: { start: { blockId: "f1" }, end: { blockId: "sh1" }, ...attrs } });
    // The edge anchor with the fractional stand (0, 0.25, and 1 are the
    // valid corners of the range).
    for (const t of [0, 0.25, 1]) {
      const valid = validateDoc(conn({ start: { blockId: "f1", port: "north", portT: t } }));
      expect(valid.some((e) => e.path.startsWith("blocks.c1.attrs.start"))).toBe(false);
    }
    // Out of the side's range.
    const tooHigh = validateDoc(conn({ start: { blockId: "f1", port: "north", portT: 1.5 } }));
    expect(tooHigh.some((e) => e.path === "blocks.c1.attrs.start.portT")).toBe(true);
    const tooLow = validateDoc(conn({ start: { blockId: "f1", port: "north", portT: -0.1 } }));
    expect(tooLow.some((e) => e.path === "blocks.c1.attrs.start.portT")).toBe(true);
    // portT without the port stands no anchor position.
    const noPort = validateDoc(conn({ start: { blockId: "f1", portT: 0.5 } }));
    expect(noPort.some((e) => e.path === "blocks.c1.attrs.start")).toBe(true);
    // On a FREE point the port stands the frozen direction — portT is
    // meaningless there (it stands no anchor position).
    const free = validateDoc(conn({ start: { x: 10, y: 20, port: "east", portT: 0.5 }, end: { blockId: "sh1" } }));
    expect(free.some((e) => e.path === "blocks.c1.attrs.start")).toBe(true);
  });

  it("rejects a malformed geometry of any block (the strict shape)", () => {
    const withGeometry = (geometry: unknown) =>
      withBlock("p1", { type: "paragraph", geometry, content: [{ text: "page", marks: {} }] });
    const missing = validateDoc(withGeometry({ x: 1, y: 2 }));
    expect(missing.some((e) => e.path === "blocks.p1.geometry.w")).toBe(true);
    const zero = validateDoc(withGeometry({ x: 1, y: 2, w: 0, h: 10 }));
    expect(zero.some((e) => e.path === "blocks.p1.geometry.w")).toBe(true);
    const nonNumeric = validateDoc(withGeometry({ x: "1", y: 2, w: 10, h: 10 }));
    expect(nonNumeric.some((e) => e.path === "blocks.p1.geometry.x")).toBe(true);
    const nanRotation = validateDoc(withGeometry({ x: 1, y: 2, w: 10, h: 10, rotation: Number.NaN }));
    expect(nanRotation.some((e) => e.path === "blocks.p1.geometry.rotation")).toBe(true);
    const unknownField = validateDoc(withGeometry({ x: 1, y: 2, w: 10, h: 10, z: 0 }));
    expect(unknownField.some((e) => e.path === "blocks.p1.geometry.z")).toBe(true);
    const notAnObject = validateDoc(withGeometry([1, 2, 3, 4]));
    expect(notAnObject.some((e) => e.path === "blocks.p1.geometry")).toBe(true);
    // The geometry is allowed on any block type (including non-canvas ones).
    const onShape = validateDoc(
      withBlock("sh2", { type: "shape", attrs: { variant: "rounded" }, geometry: { x: 1, y: 2, w: 5, h: 5 } })
    );
    expect(onShape).toEqual([]);
  });

  it("enforces the child-type rules: no canvas types at the page root, no nested surface, no frame-in-frame, no canvas types in cells", () => {
    const scene = canvasDoc();

    const shapeAtRoot = validateDoc({
      ...scene,
      blocks: {
        ...scene.blocks,
        d1: { type: "root", children: ["s1", "p1", "sh9"] },
        sh9: { type: "shape", attrs: { variant: "rect" } },
      },
    });
    expect(shapeAtRoot.some((e) => e.message.includes('not allowed as a child of "root"'))).toBe(true);

    const nestedSurface = validateDoc({
      ...scene,
      blocks: {
        ...scene.blocks,
        s1: { type: "surface", children: ["f1", "sh1", "sh2", "c1", "t1", "e1", "s2"] },
        s2: { type: "surface", children: [] },
      },
    });
    expect(nestedSurface.some((e) => e.path === "blocks.s1.children[6]")).toBe(true);

    const frameInFrame = validateDoc({
      ...scene,
      blocks: {
        ...scene.blocks,
        f1: { type: "frame", children: ["fh1", "fp1", "f2"], geometry: { x: -80, y: -40, w: 200, h: 100 } },
        f2: { type: "frame", children: [] },
      },
    });
    expect(frameInFrame.some((e) => e.path === "blocks.f1.children[2]")).toBe(true);

    const surfaceInFrame = validateDoc({
      ...scene,
      blocks: {
        ...scene.blocks,
        f1: { type: "frame", children: ["fh1", "fp1", "s2"] },
        s2: { type: "surface", children: [] },
      },
    });
    expect(surfaceInFrame.some((e) => e.path === "blocks.f1.children[2]")).toBe(true);

    const tableScene: DocJSON = {
      v: 1,
      id: "d2",
      title: "",
      createdAt: CREATED_AT,
      blocks: {
        d2: { type: "root", children: ["t1"] },
        t1: { type: "table", attrs: { cols: 1 }, children: ["r1"] },
        r1: { type: "table-row", children: ["c1", "sh1"] },
        c1: { type: "table-cell", content: [] },
        sh1: { type: "shape", attrs: { variant: "rect" } },
      },
    };
    const inCell = validateDoc(tableScene);
    expect(inCell.some((e) => e.message.includes('not allowed as a child of "table-row"'))).toBe(true);
  });
});

describe("structure (commands)", () => {
  it("the surface holds the canvas element set; moveBlock within the children is the z-order change", () => {
    const doc = newDoc();
    const surface = doc.insertBlock("surface");
    const shape = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const text = doc.insertBlock("canvas-text", undefined, { parent: surface });
    const frame = doc.insertBlock("frame", undefined, { parent: surface });

    expect(doc.getChildren(surface)).toEqual([shape, text, frame]);
    // The z-order: move the first element to the back (the pre-move index
    // semantics, like any other parent: toIndex === toLength appends).
    doc.moveBlock(shape, surface, 3);
    expect(doc.getChildren(surface)).toEqual([text, frame, shape]);
    doc.moveBlock(frame, surface, 0);
    expect(doc.getChildren(surface)).toEqual([frame, text, shape]);
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("removeBlock cascades the whole canvas subtree (the frame's page blocks included)", () => {
    const doc = newDoc();
    const surface = doc.insertBlock("surface");
    const frame = doc.insertBlock("frame", undefined, { parent: surface });
    const heading = doc.insertBlock("heading", { level: 1 }, { parent: frame });
    const shape = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });

    doc.removeBlock(surface);
    for (const id of [surface, frame, heading, shape]) expect(doc.getBlock(id)).toBeNull();
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("canvas-text is a text block: runs live in its content", () => {
    const doc = newDoc();
    const surface = doc.insertBlock("surface");
    const text = doc.insertBlock("canvas-text", undefined, { parent: surface });
    doc.insertText(text, 0, "hello canvas");
    doc.setMark(text, 0, 5, { type: "bold" });

    expect(doc.getText(text)).toBe("hello canvas");
    const block = doc.getBlock(text);
    expect(block).not.toBeNull();
    expect(block?.type).toBe("canvas-text");
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("the frame holds page blocks (the nesting is the indent attr)", () => {
    const doc = newDoc();
    const surface = doc.insertBlock("surface");
    const frame = doc.insertBlock("frame", undefined, { parent: surface });
    const item = doc.insertBlock("list-item", { list: "bullet" }, { parent: frame });
    const nested = doc.insertBlock("list-item", { list: "bullet" }, { parent: frame });
    doc.updateBlock(nested, { indent: 1 }); // the frame's nested page is a flat sequence
    doc.insertText(item, 0, "item");
    doc.insertText(nested, 0, "nested");

    expect(doc.getChildren(frame)).toEqual([item, nested]);
    expect((doc.getBlock(nested) as { attrs?: { indent?: number } }).attrs?.indent).toBe(1);
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });
});

describe("group (the flat marker)", () => {
  it("the registry shape: the group is a surface element with the required members array", () => {
    const doc = newDoc();
    const surface = doc.insertBlock("surface");
    const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const b = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });

    const group = doc.insertBlock("group", { members: [a, b] }, { parent: surface });
    expect(doc.getBlock(group)).toEqual({ type: "group", attrs: { members: [a, b] } });
    expect(doc.getChildren(surface)).toEqual([a, b, group]);
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("the members are weak refs: the membership edits stand the updateBlock patch (one transact)", () => {
    const doc = newDoc();
    const surface = doc.insertBlock("surface");
    const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const b = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const c = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const group = doc.insertBlock("group", { members: [a] }, { parent: surface });

    doc.updateBlock(group, { members: [a, b, c] });
    expect(doc.getBlock(group)).toMatchObject({ attrs: { members: [a, b, c] } });
    // The dissolve at the data level: the group entry goes, the members stand.
    doc.removeBlock(group);
    expect(doc.getBlock(group)).toBeNull();
    for (const id of [a, b, c]) expect(doc.getBlock(id)).not.toBeNull();
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("the strict validator: the members shape and the no-geometry invariant", () => {
    // A malformed members (raw write — the wire's newer-minor / corrupt data):
    const source = newDoc();
    const surface = source.insertBlock("surface");
    const a = source.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const group = source.insertBlock("group", { members: [a] }, { parent: surface });
    source.raw.transact(() => {
      const block = source.raw.getMap("blocks").get(group) as Y.Map<unknown>;
      (block.get("attrs") as Y.Map<unknown>).set("members", "a"); // not an array
    });
    const badShape = validateDoc(source.toJSON());
    expect(badShape.some((entry) => entry.path === `blocks.${group}.attrs.members`)).toBe(true);

    // The no-geometry invariant: a stored geometry contradicts the derived box.
    const source2 = newDoc();
    const surface2 = source2.insertBlock("surface");
    const a2 = source2.insertBlock("shape", { variant: "rect" }, { parent: surface2 });
    const group2 = source2.insertBlock("group", { members: [a2] }, { parent: surface2 });
    source2.raw.transact(() => {
      const block = source2.raw.getMap("blocks").get(group2) as Y.Map<unknown>;
      const geometry = new Y.Map<unknown>();
      geometry.set("x", 1);
      geometry.set("y", 2);
      geometry.set("w", 3);
      geometry.set("h", 4);
      block.set("geometry", geometry);
    });
    const withGeometry = validateDoc(source2.toJSON());
    expect(withGeometry.some((entry) => entry.message.includes("derived from the members"))).toBe(true);
  });

  it("the group is canvas-only: not a page child, not a cell child", () => {
    const doc = newDoc();
    const surface = doc.insertBlock("surface");
    const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    expect(() => doc.insertBlock("group", { members: [a] })).toThrow(InvalidChildError); // the root's page set
    const table = doc.insertBlock("table", { cols: 2 });
    const row = doc.getChildren(table)[0]!;
    const cell = doc.getChildren(row)[0]!;
    expect(() => doc.insertBlock("group", { members: [a] }, { parent: cell })).toThrow(InvalidChildError);
  });

  it("the lenient read keeps a dangling member (the weak ref posture)", () => {
    const source = newDoc();
    const surface = source.insertBlock("surface");
    const a = source.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const ghost = source.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const group = source.insertBlock("group", { members: [a, ghost] }, { parent: surface });
    source.removeBlock(ghost); // the member vanishes (the race / the dissolve of another group)

    const target = newDoc();
    target.applyUpdate(source.encode());
    // The entry stands with the dangling id (the data is not rewritten);
    // the tree reads are unaffected (the group has no children of its own).
    expect(target.getBlock(group)).toMatchObject({ type: "group", attrs: { members: [a, ghost] } });
    expect(target.getChildren(surface)).toContain(group);
  });
});

describe("round-trip", () => {
  it("the canvas scene round-trips: toJSON -> fromJSON -> toJSON is identical", () => {
    const source = fromJSON(canvasDoc());
    const before = source.toJSON();
    const restored = fromJSON(before);
    expect(restored.toJSON()).toEqual(before);
  });

  it("the connector variant patch: updateBlock sets and re-sets it (one transact)", () => {
    const doc = newDoc();
    const surface = doc.insertBlock("surface");
    const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const b = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const id = doc.insertBlock("connector", { start: { blockId: a }, end: { blockId: b } }, { parent: surface });

    doc.updateBlock(id, { variant: "curved" });
    expect(doc.getBlock(id)).toMatchObject({ type: "connector", attrs: { variant: "curved" } });
    doc.updateBlock(id, { variant: "straight" });
    expect(doc.getBlock(id)).toMatchObject({ type: "connector", attrs: { variant: "straight" } });
    // The widened BlockAttrsPatch lets the type stand a shape variant on
    // any block: the per-type runtime validation rejects it.
    expect(() => doc.updateBlock(a, { variant: "straight" })).toThrow(InvalidAttrsError);
    // The other attrs stand through the variant patch.
    doc.updateBlock(id, { label: "link" });
    expect(doc.getBlock(id)).toMatchObject({ attrs: { variant: "straight", label: "link" } });
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("the start side's figure (the arrowStart enum) stands the picks, the round-trip, and the undo", () => {
    const doc = newDoc();
    const surface = doc.insertBlock("surface");
    const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const b = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const id = doc.insertBlock("connector", { start: { blockId: a }, end: { blockId: b } }, { parent: surface });

    // The start side's figure: one updateBlock per pick (one undo step),
    // independent of the end's figure.
    doc.updateBlock(id, { arrowHead: "circle", arrowStart: "arrow" });
    expect(doc.getBlock(id)).toMatchObject({ attrs: { arrowHead: "circle", arrowStart: "arrow" } });
    // The round-trip: the enum form stands through toJSON -> fromJSON.
    const restored = fromJSON(doc.toJSON());
    expect(restored.getBlock(id)).toMatchObject({ attrs: { arrowHead: "circle", arrowStart: "arrow" } });
    expect(JSON.stringify(restored.getBlock(id))).toBe(JSON.stringify(doc.getBlock(id)));

    // The undo reverts the pick to the pre-write absent (one transact per
    // updateBlock — the two undos stand the arrowHead and the arrowStart
    // reverts).
    doc.undo();
    const reverted = doc.getBlock(id);
    expect(reverted).not.toBeNull();
    if (reverted === null || reverted.type !== "connector") throw new Error("the connector must stand");
    expect(reverted.attrs).not.toHaveProperty("arrowHead");
    expect(reverted.attrs).not.toHaveProperty("arrowStart");
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });
});

describe("lenient reader (newer-minor data)", () => {
  it("reads an unknown shape variant as-is; the validator flags it", () => {
    const source = newDoc();
    const surface = source.insertBlock("surface");
    const shape = source.insertBlock("shape", { variant: "rect" }, { parent: surface });
    // A variant this core's enum does not know, written at the CRDT level:
    // the way newer-minor data arrives (over the wire, not via the commands).
    source.raw.transact(() => {
      const block = source.raw.getMap("blocks").get(shape) as Y.Map<unknown>;
      (block.get("attrs") as Y.Map<unknown>).set("variant", "hexagon");
    });

    const target = newDoc();
    target.applyUpdate(source.encode()); // the CRDT level applies remote data without validation

    expect(target.getBlock(shape)).toEqual({ type: "shape", attrs: { variant: "hexagon" } });
    const error = validateDoc(target.toJSON()).find((entry) => entry.path === `blocks.${shape}.attrs.variant`);
    expect(error?.message).toContain("hexagon");
  });

  it("reads an unknown connector variant as-is; the validator flags it", () => {
    const source = newDoc();
    const surface = source.insertBlock("surface");
    const a = source.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const b = source.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const connector = source.insertBlock(
      "connector",
      { start: { blockId: a }, end: { blockId: b } },
      { parent: surface }
    );
    // A variant this core's enum does not know, written at the CRDT level:
    // the way newer-minor data arrives (over the wire, not via the commands).
    source.raw.transact(() => {
      const block = source.raw.getMap("blocks").get(connector) as Y.Map<unknown>;
      (block.get("attrs") as Y.Map<unknown>).set("variant", "squiggly");
    });

    const target = newDoc();
    target.applyUpdate(source.encode()); // the CRDT level applies remote data without validation

    const applied = target.getBlock(connector);
    expect(applied).not.toBeNull();
    if (applied === null || applied.type !== "connector") throw new Error("the connector must stand");
    expect(applied.attrs).toMatchObject({ variant: "squiggly" });
    const error = validateDoc(target.toJSON()).find((entry) => entry.path === `blocks.${connector}.attrs.variant`);
    expect(error?.message).toContain("squiggly");
  });

  it("reads an unknown geometry field as-is; the validator flags it", () => {
    const source = newDoc();
    const p = source.insertBlock("paragraph");
    source.setGeometry(p, { x: 1, y: 2, w: 3, h: 4 });
    // A newer-minor geometry field, written at the CRDT level.
    source.raw.transact(() => {
      const block = source.raw.getMap("blocks").get(p) as Y.Map<unknown>;
      (block.get("geometry") as Y.Map<unknown>).set("z", 7);
    });

    const target = newDoc();
    target.applyUpdate(source.encode());

    expect(target.getBlock(p)).toEqual({ type: "paragraph", geometry: { x: 1, y: 2, w: 3, h: 4, z: 7 } });
    const error = validateDoc(target.toJSON()).find((entry) => entry.path === `blocks.${p}.geometry.z`);
    expect(error?.message).toContain("z");
  });

  it('maps the legacy boolean arrowStart at read (true -> "arrow", false/absent -> absent)', () => {
    const source = newDoc();
    const surface = source.insertBlock("surface");
    const a = source.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const b = source.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const on = source.insertBlock("connector", { start: { blockId: a }, end: { blockId: b } }, { parent: surface });
    const off = source.insertBlock("connector", { start: { blockId: a }, end: { blockId: b } }, { parent: surface });
    // The legacy boolean form, written at the CRDT level: the way legacy
    // playground data arrives (over the wire, not via the commands).
    source.raw.transact(() => {
      const onBlock = source.raw.getMap("blocks").get(on) as Y.Map<unknown>;
      (onBlock.get("attrs") as Y.Map<unknown>).set("arrowStart", true);
      const offBlock = source.raw.getMap("blocks").get(off) as Y.Map<unknown>;
      (offBlock.get("attrs") as Y.Map<unknown>).set("arrowStart", false);
    });

    const target = newDoc();
    target.applyUpdate(source.encode()); // the CRDT level applies remote data

    // true -> "arrow" (the start marker stands its own arrow figure).
    const onApplied = target.getBlock(on);
    expect(onApplied).not.toBeNull();
    if (onApplied === null || onApplied.type !== "connector") throw new Error("the connector must stand");
    expect(onApplied.attrs).toMatchObject({ arrowStart: "arrow" });
    // false -> absent (the key is dropped; the reader never sees a boolean).
    const offApplied = target.getBlock(off);
    expect(offApplied).not.toBeNull();
    if (offApplied === null || offApplied.type !== "connector") throw new Error("the connector must stand");
    expect(offApplied.attrs).not.toHaveProperty("arrowStart");
    // The normalized read stands clean under the strict validator (the
    // boolean never stands in the JSON; only the raw Yjs layer keeps it).
    expect(validateDoc(target.toJSON()).some((e) => e.path.includes("arrowStart"))).toBe(false);
  });
});
