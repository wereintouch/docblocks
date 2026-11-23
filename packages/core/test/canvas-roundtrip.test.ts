import { describe, expect, it } from "vitest";

import { InvalidAttrsError, fromJSON } from "../src/core";
import type { DocJSON } from "../src/schema";
import { validateDoc } from "../src/schema";
import { CREATED_AT, canvasDoc, newDoc } from "./canvas.helpers";

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

describe("legacy frame (the pre-rework nested page)", () => {
  /** The legacy shape: the frame carried its nested page in `children`. */
  const legacyFrameDoc = (): DocJSON => ({
    v: 1,
    id: "d1",
    title: "",
    createdAt: CREATED_AT,
    blocks: {
      d1: { type: "root", children: ["s1"] },
      s1: { type: "surface", children: ["f1", "sh1"] },
      f1: { type: "frame", children: ["fh1", "fp1"], geometry: { x: -80, y: -40, w: 200, h: 100 } },
      fh1: { type: "heading", attrs: { level: 2 }, content: [{ text: "frame", marks: {} }] },
      fp1: { type: "paragraph", content: [{ text: "inside the frame", marks: {} }] },
      sh1: { type: "shape", attrs: { variant: "rect" } },
    },
  });

  it("the strict validator flags the frame's children (the structural rule)", () => {
    const errors = validateDoc(legacyFrameDoc());
    expect(errors.some((e) => e.path === "blocks.f1.children")).toBe(true);
    expect(errors.some((e) => e.message.includes('Block type "frame" has no children'))).toBe(true);
  });

  it("reads a legacy frame doc leniently: the link is dropped, the blocks keep standing in the raw layer; the read is stable", () => {
    // The lenient read (the fromJSON import boundary) does not crash: the
    // children link is dropped on the read path, the child blocks keep
    // standing in the raw layer (the same posture as the dangling order
    // ids — the strict validator flags the state, the read stands it).
    const doc = fromJSON(legacyFrameDoc());
    expect(doc.getChildren("f1")).toEqual([]);
    expect(doc.getBlock("fh1")).not.toBeNull();
    expect(doc.getBlock("fp1")).not.toBeNull();
    expect(doc.getChildren("s1")).toEqual(["f1", "sh1"]);

    // The export is flat: the frame entry carries no children field, the
    // orphaned child blocks stand in the blocks map; the re-read is
    // byte-identical (the read is deterministic).
    const exported = doc.toJSON();
    expect((exported.blocks.f1 as { children?: unknown }).children).toBeUndefined();
    expect(exported.blocks.fh1).toBeDefined();
    expect(exported.blocks.fp1).toBeDefined();
    expect(fromJSON(exported).toJSON()).toEqual(exported);
  });

  it("the legacy frame's malformed children (not an array) is rejected on the lenient import too", () => {
    const malformed = legacyFrameDoc();
    (malformed.blocks.f1 as { children?: unknown }).children = "not-an-array";
    expect(() => fromJSON(malformed)).toThrow();
  });
});
