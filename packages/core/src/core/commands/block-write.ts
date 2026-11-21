/**
 * The shared head of the insertBlock command: the InsertBlockPosition /
 * InsertBlockArgs argument types, the isPlainObject guard, and
 * writeNewBlock — the fresh-block writer that creates only the fields the
 * block type carries per the registry.
 */
import * as Y from "yjs";

import { BLOCK_REGISTRY } from "@docblocks-core/schema";
import type { AttrsFor, BlockId, BlockType } from "@docblocks-core/schema";

import { writeAttrValue } from "../layout";

/** Where to insert a new block: under `parent`, after the sibling `after`. */
interface InsertBlockPosition {
  /** Parent block id; defaults to the root block (id === doc id). */
  parent?: BlockId;
  /** Existing child of `parent`; the new block lands right after it. */
  after?: BlockId;
  /** Explicit block id (additive). The id stands in the blocks map and
   *  the parent's order; a collision with an existing block is rejected.
   *  The write is idempotent: a concurrent peer insert of the same id
   *  (the deterministic tail paragraph) converges to one block and one
   *  order slot. */
  id?: BlockId;
}

/**
 * Argument tuple of `insertBlock`: attrs are required exactly when the type
 * has attrs (see AttrsFor); `at` is optional. The table's `cols` is a
 * creation hint (the initial column count that seeds the columnOrder), not a
 * stored attr — it is accepted in the insert attrs only. The table check is
 * non-distributive (`[T] extends ["table"]`): a distributive form would
 * collapse a union type argument (e.g. "paragraph" | "list-item") into
 * per-member tuples and reject the call.
 */
type InsertBlockArgs<T extends BlockType> = [T] extends ["table"]
  ? [type: T, attrs?: AttrsFor<T> & { cols?: number }, at?: InsertBlockPosition]
  : undefined extends AttrsFor<T>
    ? [type: T, attrs?: AttrsFor<T>, at?: InsertBlockPosition]
    : [type: T, attrs: AttrsFor<T>, at?: InsertBlockPosition];

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Writes a fresh block, creating only the fields its type has per the registry. */
function writeNewBlock(blocks: Y.Map<unknown>, id: string, type: BlockType, attrs: unknown): void {
  const spec = BLOCK_REGISTRY[type];
  const yblock = new Y.Map<unknown>();
  yblock.set("type", type);

  // The attrs map is kept by reference: an unattached Y.Map cannot be read
  // back through yblock.get (the read lands before the attach), so the
  // type-specific branches below extend the local map instead.
  let attrsMap: Y.Map<unknown> | undefined;
  if (spec.attrs !== undefined && isPlainObject(attrs)) {
    // The table's columnWidths are stored identity-keyed (columnId → width,
    // seeded from the caller's positional array by the insert transaction,
    // which knows the generated column ids) — skipped here.
    const attrEntries = Object.entries(attrs).filter(
      ([key, value]) => value !== undefined && !(type === "table" && key === "columnWidths")
    );
    if (attrEntries.length > 0) {
      attrsMap = new Y.Map<unknown>();
      for (const [key, value] of attrEntries) writeAttrValue(attrsMap, key, value);
      yblock.set("attrs", attrsMap);
    }
  }

  if (spec.content) yblock.set("content", new Y.Text());
  if (spec.children) yblock.set("children", new Y.Array<string>());
  if (spec.rows) {
    yblock.set("rows", new Y.Map<unknown>());
    yblock.set("rowOrder", new Y.Array<string>());
  }
  if (spec.columnOrder) {
    // The fresh table holds no width entries yet (an absent entry stands
    // the default width at read time); the insert transaction seeds the
    // caller's widths identity-keyed, keyed by the generated column ids.
    yblock.set("columnOrder", new Y.Array<string>());
  }
  blocks.set(id, yblock);
}

export { isPlainObject, writeNewBlock };
export type { InsertBlockArgs, InsertBlockPosition };
