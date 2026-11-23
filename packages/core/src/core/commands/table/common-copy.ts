/** The table's subtree-copy helpers: the descendant walk, the clear, the
 * rowless→paragraph convert, and the snapshot/write phases of a subtree
 * copy (the cells' mini-docs' stand). They run inside the caller's
 * transaction (the snapshot phase is a pure read over it); none of them
 * opens a transaction of its own. The layout's accessors stand in the
 * sibling common-layout.ts, the value's checks / the widths / the colors
 * in common-values.ts (the former common.ts's stand). */
import * as Y from "yjs";

import type { Block } from "@docblocks-core/schema";

import { UnknownBlockError } from "../../errors";
import { writeBlock } from "../../layout";
import type { WritableBlock } from "../../layout";
import { readBlock } from "../../read";
import { childrenOf, findParent, getBlockMap, getBlocks } from "../structure";
import { changeBlockType } from "../types";

/** The block's subtree (itself first, descendants in BFS order). */
function collectSubtree(ydoc: Y.Doc, id: string): string[] {
  const result = [id];
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    const children = childrenOf(ydoc, current);
    if (children === null) continue;
    for (const child of children.toArray()) {
      result.push(child);
      stack.push(child);
    }
  }
  return result;
}

/** Removes a block's descendants (the block itself stays) inside the caller's transaction. */
function clearBlockChildren(ydoc: Y.Doc, blockId: string): void {
  const cell = getBlockMap(ydoc, blockId);
  if (cell === null) return;
  const blocks = getBlocks(ydoc);
  for (const id of collectSubtree(ydoc, blockId).slice(1)) blocks.delete(id);
  const children = cell.get("children");
  if (children instanceof Y.Array) (children as Y.Array<string>).delete(0, children.length);
  // The legacy cell content (pre the child-paragraph form) is dropped too.
  const content = cell.get("content");
  if (content instanceof Y.Text) content.delete(0, content.length);
}

/**
 * Converts a rowless table into a paragraph in place (the caller runs it
 * after the last row is gone, inside its own transaction): the type
 * change drops the table-only attrs (cols/columnWidths) and keeps the
 * indent; the content array starts empty.
 */
function convertToParagraph(ydoc: Y.Doc, tableId: string): void {
  changeBlockType(ydoc, undefined, tableId, "paragraph", undefined);
}

/**
 * The snapshot phase of a subtree copy (pure reads, outside any
 * transaction): the source ids + their JSON snapshots + the fresh ids.
 */
function snapshotSubtree(
  ydoc: Y.Doc,
  generateId: () => string,
  rootId: string
): { ids: string[]; jsons: (Block | null)[]; newIds: string[]; idMap: Map<string, string> } {
  const ids = collectSubtree(ydoc, rootId);
  const jsons = ids.map((id) => readBlock(ydoc, id));
  const newIds = ids.map(() => generateId());
  const idMap = new Map(ids.map((oldId, i) => [oldId, newIds[i]!]));
  return { ids, jsons, newIds, idMap };
}

/**
 * The write phase of a subtree copy (the caller runs it inside its own
 * transaction): writes the remapped block entries with the fresh ids and
 * returns the new root id.
 */
function writeSubtreeCopy(
  ydoc: Y.Doc,
  snap: { ids: string[]; jsons: (Block | null)[]; newIds: string[]; idMap: Map<string, string> }
): string {
  const { ids, jsons, newIds, idMap } = snap;
  const blocks = getBlocks(ydoc);
  ids.forEach((oldId, i) => {
    const json = jsons[i]!;
    if (json === null) throw new UnknownBlockError(`Block "${oldId}" vanished while copying (corrupt layout).`);
    const entry: WritableBlock = { type: json.type };
    if ("attrs" in json && json.attrs !== undefined) entry.attrs = json.attrs;
    if ("geometry" in json && json.geometry !== undefined) entry.geometry = json.geometry;
    if ("content" in json && json.content !== undefined) entry.content = json.content;
    if ("children" in json && json.children !== undefined) {
      entry.children = json.children.map((childId) => idMap.get(childId) ?? childId);
    }
    writeBlock(blocks, newIds[i]!, entry);
    // The owner parent (the single CRDT-resolved ownership stand): the
    // remapped old parent — a parent inside the copy set stands its fresh
    // id, the container outside the set (the copy's root over the table /
    // the row) stands by its id. Without the field the read path falls
    // back to the array search.
    const oldParent = findParent(ydoc, oldId);
    if (oldParent !== null) {
      const blockMap = blocks.get(newIds[i]!);
      if (blockMap instanceof Y.Map) blockMap.set("parent", idMap.get(oldParent) ?? oldParent);
    }
  });
  return newIds[0]!;
}

export { clearBlockChildren, collectSubtree, convertToParagraph, snapshotSubtree, writeSubtreeCopy };
