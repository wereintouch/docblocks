/** The table block's pure helpers: the handle classes, the drop-position
 * math, the cell's plain-text read / the context-menu paste seat, the
 * clipboard read, the width clamp and the add chip's drag count. */
import { BLOCK_REGISTRY } from "docblocks-core";
import type { BlockId, Doc } from "docblocks-core";

import { plainTextOfHtml } from "../../editing/clipboard";
import { cn } from "../../shared/ui/cn";
import { ADD_COLUMN_DRAG_STEP_PX, ADD_ROW_DRAG_STEP_PX, MIN_COLUMN_WIDTH } from "./constants";
import type { HandleKind } from "./models";

/** The handle chip's classes (revealed when hovered / dragged / menued). */
function handleClasses(visible: boolean, dragging: boolean): string {
  return cn(
    `
      absolute z-10 flex size-5 cursor-grab items-center justify-center rounded-md border border-border bg-muted
      text-foreground shadow-xs transition-opacity focus-visible:opacity-100
    `,
    dragging && "cursor-grabbing",
    visible ? "opacity-100" : "pointer-events-none opacity-0"
  );
}
/**
 * The drop position (0..stationaryWidths.length) of a dragged column for a
 * pointer x (relative to the table's left edge) among the stationary
 * columns: the first column whose midpoint stands right of the pointer.
 * The stationary widths exclude the dragged column (its preview transform
 * does not shift the others).
 */
function columnDropPosition(stationaryWidths: number[], x: number): number {
  let acc = 0;
  for (let i = 0; i < stationaryWidths.length; i++) {
    const width = stationaryWidths[i]!;
    if (x <= acc + width / 2) return i;
    acc += width;
  }
  return stationaryWidths.length;
}
/**
 * The drop position (0..midpoints.length) of a dragged row for a pointer y
 * (relative to the table's top edge) among the stationary row midpoints
 * (ascending): the count of the midpoints standing above the pointer.
 */
function rowDropPosition(midpoints: number[], y: number): number {
  let position = 0;
  for (const mid of midpoints) {
    if (y > mid) position++;
    else break;
  }
  return position;
}
/** Two equal-length sequences with equal elements at every position. */
function sameSequence(a: readonly (string | number)[], b: readonly (string | number)[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}
/**
 * The plain text of the cell's content (the context menu's copy payload):
 * the cell's own text (the soft breaks stand as the run's `\n`) first, then
 * the text children's text joined with `\n` between the blocks; the
 * non-text children contribute nothing (v1). Parts the cell carries no
 * text in are skipped.
 */
function cellPlainText(doc: Doc, cellId: BlockId): string {
  const cell = doc.getBlock(cellId);
  if (cell === null || cell.type !== "table-cell") return "";
  const parts: string[] = [];
  // The cell's own content stands above the children (the text-cell shape).
  const own = doc.getText(cellId);
  if (own !== "") parts.push(own);
  for (const child of cell.children ?? []) {
    const block = doc.getBlock(child);
    if (block === null || !BLOCK_REGISTRY[block.type].content) continue;
    parts.push(doc.getText(child));
  }
  return parts.join("\n");
}
/**
 * The context menu's paste seat: the plain text lands at the end of the
 * cell's LAST text child (the menu carries no caret context, v1); a cell
 * without a text child gets a fresh paragraph (a cell whose own runs
 * stand still takes the children — the layer is the typed-text surface,
 * the menu paste is the block-content one). One transact (one undo step,
 * one wire update); the multi-line text stands as soft breaks — the cell
 * paragraphs are plain text only, like the cell's paste pipeline.
 */
function pasteCellText(doc: Doc, cellId: BlockId, text: string): { blockId: BlockId; offset: number } | null {
  if (text === "") return null;
  const normalized = text.replace(/\r\n?/g, "\n");
  // The seat target survives the transact via a property (a closure-
  // assigned variable is not flow-narrowed past the call).
  const seat: { target: { blockId: BlockId; offset: number } | null } = { target: null };
  doc.transact(() => {
    const cell = doc.getBlock(cellId);
    if (cell === null || cell.type !== "table-cell") return;
    const children = cell.children ?? [];
    let existing: BlockId | null = null;
    for (let i = children.length - 1; i >= 0; i--) {
      const child = doc.getBlock(children[i]!);
      if (child !== null && BLOCK_REGISTRY[child.type].content) {
        existing = children[i]!;
        break;
      }
    }
    if (existing !== null) {
      const length = doc.getTextLength(existing);
      doc.insertText(existing, length, normalized);
      seat.target = { blockId: existing, offset: length + normalized.length };
    } else {
      const paragraph = doc.insertBlock("paragraph", undefined, { parent: cellId });
      doc.insertText(paragraph, 0, normalized);
      seat.target = { blockId: paragraph, offset: normalized.length };
    }
  });
  return seat.target;
}
/**
 * The clipboard's plain text (the context menu's paste payload): the
 * text/plain item wins; an html-only payload degrades to its plain text
 * (the marks are dropped — the cell paragraphs stand plain text only).
 * An unreadable clipboard (a read the page may not allow) stands an empty
 * string (the paste is a no-op).
 */
async function readClipboardText(): Promise<string> {
  let items: ClipboardItems;
  try {
    items = await navigator.clipboard.read();
  } catch {
    return "";
  }
  let html = "";
  for (const item of items) {
    const types = item.types;
    if (types.includes("text/plain")) {
      const blob = await item.getType("text/plain");
      return blob.text();
    }
    if (html === "" && types.includes("text/html")) {
      const blob = await item.getType("text/html");
      html = await blob.text();
    }
  }
  return html === "" ? "" : plainTextOfHtml(html);
}
/** The resize width's clamp: the 50 px floor, no ceiling (the overflow scrolls). */
function clampColumnWidth(width: number): number {
  return Math.max(Math.round(width), MIN_COLUMN_WIDTH);
}
/**
 * The add chip's drag delta -> the count (positive = the add, negative =
 * the remove): the nearest step's count (the rows' step 24 px, the
 * columns' the base width 100 px); the floor clamps the removal to keep
 * at least one row / column (the full removal is the handle's menu
 * delete only — the paragraph conversion), the add stands unclamped (the
 * travel's count is the intent).
 */
function addDragCount(kind: HandleKind, total: number, delta: number): number {
  const step = kind === "row" ? ADD_ROW_DRAG_STEP_PX : ADD_COLUMN_DRAG_STEP_PX;
  const raw = Math.round(delta / step);
  if (raw >= 0) return raw;
  return Math.max(1 - total, raw);
}

export {
  addDragCount,
  cellPlainText,
  clampColumnWidth,
  columnDropPosition,
  handleClasses,
  pasteCellText,
  readClipboardText,
  rowDropPosition,
  sameSequence,
};
