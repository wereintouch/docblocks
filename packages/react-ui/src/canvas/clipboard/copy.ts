/** The canvas clipboard's copy: the deep copy of the copied canvas items. The
 * clipboard is the view state per editor (not doc data, no wire). The copy is
 * autonomous (not tied to the original); the frame is excluded from it. Pure
 * functions over the plain `Doc` reader — testable without React. */
import type { Block, BlockId, Doc } from "docblocks-core";

import type { CanvasClipboard, ClipboardItem } from "./models";

/**
 * The deep copy of the given block's data (the attrs / the text / the
 * geometry — the plain JSON clone: the copy never aliases the doc's
 * snapshot, and the original's later edits stand the copy out).
 */
function cloneItem(block: Block): ClipboardItem | null {
  if (block.type !== "shape" && block.type !== "connector" && block.type !== "canvas-text" && block.type !== "group") {
    return null;
  }
  // The attrs / the content stand plain JSON (the plainness contract) —
  // the JSON clone is the deep copy (the original's later edits stand
  // the copy out).
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  const geometry = block.geometry === undefined ? undefined : { ...block.geometry };
  if (block.type === "shape") {
    return { type: "shape", attrs: block.attrs === undefined ? undefined : clone(block.attrs), geometry };
  }
  if (block.type === "connector") {
    if (block.attrs === undefined) return null;
    return { type: "connector", attrs: clone(block.attrs), geometry };
  }
  if (block.type === "canvas-text") {
    return {
      type: "canvas-text",
      attrs: block.attrs === undefined ? undefined : clone(block.attrs),
      content: block.content === undefined ? undefined : clone(block.content),
      geometry,
    };
  }
  // The group
  if (block.attrs === undefined) return null;
  return { type: "group", attrs: clone(block.attrs), geometry };
}

/**
 * The copy snapshot over the selection ids: every copiable id stands its
 * deep data; a container's transitive members ride the copy (the
 * membership remaps at the paste — the copy is the whole container, not
 * the marker); a frame and the page block (the root's miniature) stand
 * the copy out. Returns `null` when no copiable item stands (the empty
 * copy).
 */
function copyCanvasItems(doc: Doc, ids: readonly BlockId[]): CanvasClipboard | null {
  const items = new Map<BlockId, ClipboardItem>();
  const topLevel: BlockId[] = [];
  const visit = (id: BlockId, top: boolean): void => {
    if (items.has(id)) return;
    const block = doc.getBlock(id);
    if (block === null) return;
    if (block.type === "frame") return; // the frame stands the copy out
    const item = cloneItem(block);
    if (item === null) return;
    items.set(id, item);
    if (top) topLevel.push(id);
    if (item.type === "group") {
      // The transitive membership (a nested container's members ride the
      // outer's copy — the members stand the copy out of the selection's
      // stand: the container's outline takes over).
      for (const memberId of item.attrs.members) visit(memberId, false);
    }
  };
  for (const id of ids) visit(id, true);
  if (items.size === 0) return null;
  return { entries: [...items.entries()].map(([id, item]) => ({ id, item })), ids: topLevel };
}

export { copyCanvasItems };
