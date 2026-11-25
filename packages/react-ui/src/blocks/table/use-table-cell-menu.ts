/** The table cell's right-click menu (copy / paste / clear): the
 * release-open gesture (the held right press's open stands the gesture's
 * pointerup) and the menu's doc commands (the copy over the cell's plain
 * text, the paste over the clipboard's plain text, the clear over the
 * cell's own content + the children cascade). */
import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import type { BlockId, Doc } from "docblocks-core";

import { focusCaretIn } from "../../editing/block-commands";
import { anchorOfId, useSetTableCellRange, useTableRangeOf } from "./use-table-cell-range";
import { cellPlainText, pasteCellText, readClipboardText } from "./utils";

interface UseTableCellMenuArgs {
  doc: Doc;
  /** The owning table (the range's commands stand over it). */
  tableId: BlockId;
  /** The read-only stand (view / published): the cell's context menu's
   * stand is off (the copy/paste/clear's items are the cell's editing's
   * paths). */
  viewMode: boolean;
  frameRef: { current: HTMLDivElement | null };
}

function useTableCellMenu({ doc, tableId, viewMode, frameRef }: UseTableCellMenuArgs) {
  // The cell context menu (the right-click): the anchor point (frame-relative)
  // and the cell; the menu's content carries the copy/paste/clear items.
  const [ctx, setCtx] = useState<{ x: number; y: number; cellId: BlockId } | null>(null);
  // The pending release-open (the held right press's open stands the
  // gesture's pointerup — the listener's cleanup stands here; a fresh
  // right-click cancels the pending one).
  const pendingCtxRef = useRef<(() => void) | null>(null);

  /**
   * The right-click on a cell: suppresses the native menu and anchors the
   * cell's menu (copy / paste / clear) at the release (frame-relative —
   * the anchor div stands in the frame, not the scrolled content).
   */
  const onTableContextMenu = (event: ReactMouseEvent<HTMLTableElement>) => {
    if (viewMode) return;
    // The link's anchor's stand: the editor root's link menu owns the
    // gesture (the cell's menu's suppress over it — the two menus' double's
    // stand is off).
    if ((event.target as HTMLElement).closest?.("a[data-slot='docblocks/link']") !== null) return;
    const cell = (event.target as HTMLElement).closest<HTMLTableCellElement>("td[data-block-id]");
    if (cell === null) return;
    const cellId = cell.dataset.blockId ?? "";
    const frame = frameRef.current;
    if (frame === null) return;
    event.preventDefault();
    // A fresh gesture cancels the previous one's pending open (the stale
    // gesture's release stands no menu at the stale point).
    if (pendingCtxRef.current !== null) {
      pendingCtxRef.current();
      pendingCtxRef.current = null;
    }
    const seat = (clientX: number, clientY: number) => {
      const rect = frameRef.current?.getBoundingClientRect();
      if (rect === undefined) return;
      setCtx({ x: clientX - rect.left, y: clientY - rect.top, cellId });
    };
    if (event.buttons === 0) {
      // The release stood (or the gesture holds no press — the synthetic
      // dispatch / the Menu key): the task's stand.
      const task = window.setTimeout(() => {
        pendingCtxRef.current = null;
        seat(event.clientX, event.clientY);
      }, 0);
      pendingCtxRef.current = () => window.clearTimeout(task);
      return;
    }
    // The right button stands held (the real press): the open stands the
    // gesture's release — an open over the held press puts the first item
    // under the release point, and the Radix item stands the buttonless up
    // as a select (the release "clicks" the first item and closes the menu
    // — the "the menu flashes and stands gone" stand).
    const onUp = (up: PointerEvent) => {
      if (up.button !== 2) {
        // A foreign gesture's release: the gesture's own release stands.
        window.addEventListener("pointerup", onUp, { once: true });
        return;
      }
      pendingCtxRef.current = null;
      seat(up.clientX, up.clientY);
    };
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onUp, { once: true });
    pendingCtxRef.current = () => {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  };

  const cellScope = () => frameRef.current?.closest<HTMLElement>('[data-slot="docblocks/editor"]') ?? document;

  // The cell range (the merge gesture's stand) and its clear.
  const range = useTableRangeOf(tableId);
  const setRange = useSetTableCellRange();
  /** The clicked cell's merged region stand (`colspan`/`rowspan` over 1). */
  const clicked = ctx === null ? null : doc.getBlock(ctx.cellId);
  const clickedSpan =
    clicked !== null && clicked.type === "table-cell"
      ? Math.max(clicked.attrs?.colspan ?? 1, clicked.attrs?.rowspan ?? 1)
      : 1;
  /** The merge stands over a selected rectangle of at least two cells. */
  const canMerge = range !== null && range.tableId === tableId && range.cellIds.length > 1;
  /** The split stands over a merged cell (the clicked one or the range's). */
  const canSplit = clickedSpan > 1 || (range !== null && range.cellIds.length === 1 && clickedSpan > 1);

  /** The merge: the selected rectangle folds into its top-left cell (one undo step); the range clears. */
  const onMergeCells = () => {
    if (!canMerge || range === null) return;
    try {
      doc.mergeTableCells(range.tableId, { row: range.top, col: range.left }, { row: range.bottom, col: range.right });
    } catch {
      // A rejected rectangle (a gap / a partial region — the menu's stand
      // read a stale grid): no-op.
    }
    setRange(null);
  };

  /** The split: the merged region containing the clicked cell (or the range's cell) expands. */
  const onSplitCells = () => {
    if (ctx === null) return;
    const anchor = anchorOfId(doc, tableId, ctx.cellId);
    if (anchor === null) return;
    try {
      doc.splitTableCells(tableId, anchor.row, anchor.col);
    } catch {
      // A rejected coordinate (the cell moved mid-gesture): no-op.
    }
    setRange(null);
  };

  /** The copy: the cell's plain text to the clipboard (the blocks joined
   * with the line break); an unreadable clipboard stands a no-op (v1). */
  const onCellCopy = async () => {
    if (ctx === null) return;
    const text = cellPlainText(doc, ctx.cellId);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // The page may not hold the write (permissions) — the v1 no-op.
    }
  };

  /** The paste: the clipboard's plain text into the cell (the seat is the
   * last text child's end; an empty cell materializes its paragraph) —
   * the caret seats in the landed text. */
  const onCellPaste = async () => {
    if (ctx === null) return;
    const text = await readClipboardText();
    if (text === "") return;
    const seat = pasteCellText(doc, ctx.cellId, text);
    if (seat !== null) focusCaretIn(seat.blockId, seat.offset, cellScope());
  };

  /** The clear: the cell's own content and the children cascade out
   * (one transact, one undo step); the cell stands the activation layer. */
  const onCellClear = () => {
    if (ctx === null) return;
    try {
      doc.transact(() => {
        const cell = doc.getBlock(ctx.cellId);
        if (cell === null || cell.type !== "table-cell") return;
        const ownLength = doc.getTextLength(ctx.cellId);
        if (ownLength > 0) doc.deleteText(ctx.cellId, 0, ownLength);
        for (const child of cell.children ?? []) doc.removeBlock(child);
      });
    } catch {
      // A rejected removal (the cell re-parented mid-gesture): no-op.
    }
  };

  const closeCtx = (open: boolean) => {
    if (!open) setCtx(null);
  };

  // The unmount cancels the pending release-open (the gesture's release
  // over the dead frame stands no menu).
  useEffect(
    () => () => {
      if (pendingCtxRef.current !== null) {
        pendingCtxRef.current();
        pendingCtxRef.current = null;
      }
    },
    []
  );

  return {
    ctx,
    canMerge,
    canSplit,
    onMergeCells,
    onSplitCells,
    closeCtx,
    onCellClear,
    onCellCopy,
    onCellPaste,
    onTableContextMenu,
  };
}

export { useTableCellMenu };
