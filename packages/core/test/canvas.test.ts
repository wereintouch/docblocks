import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import type { DocJSON } from "../src/schema";
import { validateDoc } from "../src/schema";
import { CREATED_AT, canvasDoc, newDoc, withBlock } from "./canvas.helpers";

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
    expect(target.getBlock(shape)).toEqual({ type: "shape", attrs: { variant: "line", zIndex: 1 } });
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
    // frozen direction — the last anchor's side): all valid (additive).
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

  it("checks the connector style attrs (the strokeColor / strokeWidth / strokeStyle / arrowHead / arrowStart, registry-driven)", () => {
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
    // The stroke style's enum (solid / dash / dot; the absent value stands
    // the solid render — the validator does not require it).
    const badStyle = validateDoc(conn({ strokeStyle: "wavy" }));
    expect(badStyle.some((e) => e.path === "blocks.c1.attrs.strokeStyle")).toBe(true);
    // The full set stands (the strict validator is clean).
    const valid = validateDoc(
      conn({ strokeColor: "#ff0000", strokeWidth: 4, strokeStyle: "dot", arrowHead: "circle", arrowStart: "circle" })
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
    // The removed rotation field: a finite legacy value stands the
    // unknown-field branch (the strict validator rejects it).
    const legacyRotation = validateDoc(withGeometry({ x: 1, y: 2, w: 10, h: 10, rotation: 7 }));
    const rotationError = legacyRotation.find((e) => e.path === "blocks.p1.geometry.rotation");
    expect(rotationError?.message).toBe('Unknown field "rotation" for geometry.');
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

  it("enforces the child-type rules: no canvas-only types at the page root (the frame is the page exception), no nested surface, no children on the frame, no canvas types in cells", () => {
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

    // The frame is a viewport window (no children): the field is a
    // structural error (the strict posture; the lenient load drops the
    // link — the legacy read below).
    const frameChildren = validateDoc(
      withBlock("f1", { type: "frame", children: ["sh1"], geometry: { x: -80, y: -40, w: 200, h: 100 } })
    );
    expect(frameChildren.some((e) => e.message.includes('Block type "frame" has no children'))).toBe(true);

    const tableScene: DocJSON = {
      v: 1,
      id: "d2",
      title: "",
      createdAt: CREATED_AT,
      blocks: {
        d2: { type: "root", children: ["t1"] },
        t1: { type: "table", columnOrder: ["col1"], children: ["r1"] },
        r1: { type: "table-row", children: ["c1", "sh1"] },
        c1: { type: "table-cell", attrs: { columnId: "col1" }, content: [] },
        sh1: { type: "shape", attrs: { variant: "rect" } },
      },
    };
    const inCell = validateDoc(tableScene);
    expect(inCell.some((e) => e.message.includes('not allowed as a child of "table-row"'))).toBe(true);
  });
});
