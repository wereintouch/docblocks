/**
 * The layout's opaque block write (the cross-minor stand): the fields of an
 * unknown-type block (a future minor's data, the lenient load) are written
 * as-is, with no registry gating, so a save keeps the data the engine does
 * not know. The read path (`readOpaqueBlock`) keeps it intact too. The
 * type-specific fields (rows / rowOrder / columnOrder) belong to the known
 * types and are never written here.
 */
import * as Y from "yjs";

import type { OpaqueBlock, TextRun } from "@docblocks-core/schema";

import { markSetToAttrs } from "../text-model";
import type { AnyMap } from "./models";
import { isPlainObject, writeAttrValue } from "./write-value";

function writeOpaqueBlock(blocks: AnyMap, id: string, block: OpaqueBlock): void {
  const yblock = new Y.Map<unknown>();
  yblock.set("type", block.type);

  if (isPlainObject(block.attrs)) {
    const attrEntries = Object.entries(block.attrs).filter(([, value]) => value !== undefined);
    if (attrEntries.length > 0) {
      const attrs = new Y.Map<unknown>();
      for (const [key, value] of attrEntries) writeAttrValue(attrs, key, value);
      yblock.set("attrs", attrs);
    }
  }

  if (isPlainObject(block.geometry)) {
    const entries = Object.entries(block.geometry).filter(
      ([, value]) => typeof value === "number" && Number.isFinite(value)
    );
    if (entries.length > 0) {
      const geometry = new Y.Map<unknown>();
      for (const [key, value] of entries) geometry.set(key, value);
      yblock.set("geometry", geometry);
    }
  }

  if (Array.isArray(block.content)) {
    const text = new Y.Text();
    const delta = block.content
      .filter((run) => isPlainObject(run) && typeof run.text === "string" && run.text !== "")
      .map((run) => {
        const attrs = markSetToAttrs((run as TextRun).marks ?? {});
        return Object.keys(attrs).length > 0 ? { insert: run.text, attributes: attrs } : { insert: run.text };
      });
    if (delta.length > 0) text.applyDelta(delta);
    yblock.set("content", text);
  }

  if (Array.isArray(block.children)) {
    const children = new Y.Array<string>();
    for (const childId of block.children) if (typeof childId === "string") children.push([childId]);
    yblock.set("children", children);
  }

  // Additive top-level fields of a future minor: written as-is (the generic
  // storage semantics — primitives as-is, plain objects as nested Y.Maps,
  // arrays as Y.Arrays) so a save keeps the data the engine does not know.
  const known = new Set(["type", "attrs", "content", "children", "geometry"]);
  for (const [key, value] of Object.entries(block)) {
    if (known.has(key)) continue;
    writeAttrValue(yblock, key, value);
  }

  blocks.set(id, yblock);
}

export { writeOpaqueBlock };
