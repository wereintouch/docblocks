import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { validateDoc } from "../src/schema";
import { newDoc } from "./canvas.helpers";

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

    expect(target.getBlock(shape)).toEqual({ type: "shape", attrs: { variant: "hexagon", zIndex: 1 } });
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

  it("reads the legacy geometry rotation as-is; the validator flags it", () => {
    const source = newDoc();
    const p = source.insertBlock("paragraph");
    source.setGeometry(p, { x: 1, y: 2, w: 3, h: 4 });
    // The legacy rotation field, written at the CRDT level: the way
    // legacy data arrives (over the wire, not via the commands).
    source.raw.transact(() => {
      const block = source.raw.getMap("blocks").get(p) as Y.Map<unknown>;
      (block.get("geometry") as Y.Map<unknown>).set("rotation", 45);
    });

    const target = newDoc();
    target.applyUpdate(source.encode());

    // The lenient read keeps the field untouched (the data is never rewritten).
    expect(target.getBlock(p)).toEqual({ type: "paragraph", geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 45 } });
    const rotationError = validateDoc(target.toJSON()).find((entry) => entry.path === `blocks.${p}.geometry.rotation`);
    expect(rotationError?.message).toBe('Unknown field "rotation" for geometry.');
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
