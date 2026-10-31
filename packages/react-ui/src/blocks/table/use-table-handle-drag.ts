/** The table's row/column handle drag: the handle's press + drag (the live
 * parting preview — the dragged row/column's own cells stand the pointer's
 * dx / dy, the stationary ones the parting shift), the drop index
 * measurement (the stationary columns' widths / the rows' midpoints
 * against the table's edges), the release (a non-drag press opens the
 * handle's menu; a drag commits the move after validating the live doc
 * against the press-time snapshot — a concurrent structural change stands,
 * no command, the rows resync from the doc), and the cancel. The preview's
 * state stands in the hook (the view reads the dragged row/column's live
 * position + the parting shift). */
import { useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

import type { BlockId, Doc, TableBlock as TableBlockType } from "docblocks-core";
import { DEFAULT_TABLE_COLUMN_WIDTH } from "docblocks-core";

import { DRAG_THRESHOLD } from "./constants";
import type { HandleKind, TableDragPreview, TableHandleSession } from "./models";
import { columnDropPosition, rowDropPosition, sameSequence } from "./utils";

interface TableHandleDragDeps {
  /** The handle's drag session (shared with the add chip's + the seam's
   * guards — a press starts at most one session at a time). */
  sessionRef: RefObject<TableHandleSession | null>;
  setHover: (hover: { row: number; col: number } | null) => void;
  setMenu: (menu: { kind: HandleKind; index: number } | null) => void;
  /** The table element (the live DOM — the drop measurement reads it). */
  tableEl: () => HTMLTableElement | null;
  doc: Doc;
  /** The table's row ids (the press-time snapshot). */
  rows: BlockId[];
  /** The table block (the column order + the column widths' snapshot). */
  block: TableBlockType;
  /** The table's id (the move's commit). */
  id: BlockId;
}

function useTableHandleDrag({ sessionRef, setHover, setMenu, tableEl, doc, rows, block, id }: TableHandleDragDeps) {
  const [preview, setPreview] = useState<TableDragPreview | null>(null);

  const onHandlePointerDown = (kind: HandleKind, index: number) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || sessionRef.current !== null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const table = tableEl();
    const startSize =
      kind === "column"
        ? (block.attrs?.columnWidths?.[index] ?? DEFAULT_TABLE_COLUMN_WIDTH)
        : (table?.querySelectorAll<HTMLTableRowElement>("tbody > tr")[index]?.offsetHeight ?? 0);
    sessionRef.current = {
      kind,
      index,
      rowId: kind === "row" ? (rows[index] ?? "") : "",
      cols: block.columnOrder.length,
      widths: block.attrs?.columnWidths ?? null,
      rowIds: [...rows],
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
      startSize,
    };
  };

  /**
   * The dragged column's drop index (the final visible index — the
   * pre-move doc index of the landing slot) for a pointer x: the
   * stationary columns' widths (the dragged column's own width is
   * excluded) against the table's left edge — the release's commit and
   * the live parting preview share the measurement.
   */
  const columnToIndexAt = (clientX: number, excludeIndex: number): number | null => {
    const table = tableEl();
    if (table === null) return null;
    const live = doc.getBlock(id);
    if (live === null || live.type !== "table") return null;
    const rect = table.getBoundingClientRect();
    const resolved =
      live.attrs?.columnWidths ?? Array.from({ length: live.columnOrder.length }, () => DEFAULT_TABLE_COLUMN_WIDTH);
    const stationary = resolved.filter((_, i) => i !== excludeIndex);
    const position = columnDropPosition(stationary, clientX - rect.left);
    return position;
  };

  /** The dragged row's drop index (the final visible index — the pre-move
   *  doc index of the landing slot) for a pointer y: the stationary rows'
   *  midpoints (the dragged row is excluded) against the table's top edge
   *  — the release's commit and the live parting preview share the
   *  measurement. */
  const rowToIndexAt = (clientY: number, excludeIndex: number): number | null => {
    const table = tableEl();
    if (table === null) return null;
    const rect = table.getBoundingClientRect();
    const midpoints: number[] = [];
    Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody > tr")).forEach((tr, i) => {
      if (i === excludeIndex) return;
      midpoints.push(tr.offsetTop + tr.offsetHeight / 2);
    });
    const position = rowDropPosition(midpoints, clientY - rect.top);
    return position;
  };

  const onHandlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = sessionRef.current;
    if (session === null) return;
    const dx = event.clientX - session.startX;
    const dy = event.clientY - session.startY;
    if (!session.dragging && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
      session.dragging = true;
      setHover(null);
    }
    if (session.dragging) {
      const toIndex =
        session.kind === "column"
          ? columnToIndexAt(event.clientX, session.index)
          : rowToIndexAt(event.clientY, session.index);
      setPreview({ kind: session.kind, index: session.index, dx, dy, toIndex, startSize: session.startSize });
    }
  };

  /**
   * The handle release: a non-drag press opens the handle's menu; a drag
   * commits the move after validating the live doc against the press-time
   * snapshot (a concurrent structural change stands — no command, the rows
   * resync from the doc on the next change).
   */
  const onHandlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session === null) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!session.dragging) {
      setMenu({ kind: session.kind, index: session.index });
      return;
    }
    setPreview(null);
    commitHandleDrag(session, event.clientX, event.clientY);
  };

  const onHandlePointerCancel = () => {
    sessionRef.current = null;
    setPreview(null);
  };

  const commitHandleDrag = (session: TableHandleSession, clientX: number, clientY: number) => {
    const live = doc.getBlock(id);
    if (live === null || live.type !== "table") return;
    try {
      if (session.kind === "column") {
        // A concurrent structural change (the cols count or the width
        // sequence) invalidates the drop: the column identity stands on the
        // position + its width, and a peer restructure breaks both.
        const liveWidths = live.attrs?.columnWidths ?? null;
        if (live.columnOrder.length !== session.cols || !sameSequence(liveWidths ?? [], session.widths ?? [])) return;
        const toIndex = columnToIndexAt(clientX, session.index);
        if (toIndex !== null && toIndex !== session.index) {
          // The visible landing slot S → the doc's pre-move target index
          // (the core's move lands before the target on a rightward move):
          // S right of the origin is one past the landing slot.
          doc.moveTableColumn(id, session.index, toIndex > session.index ? toIndex + 1 : toIndex);
        }
      } else {
        // The row identity is the id: a changed row sequence (a peer
        // insert/remove/move) invalidates the drop.
        const liveRows = doc.getChildren(id);
        if (!sameSequence(liveRows, session.rowIds)) return;
        const toIndex = rowToIndexAt(clientY, session.index);
        if (toIndex !== null && toIndex !== session.index) {
          doc.moveTableRow(id, session.rowId, toIndex > session.index ? toIndex + 1 : toIndex);
        }
      }
    } catch {
      // A rejected move (the concurrent change won the race between the
      // guard and the command): the doc stands as-is, the rows resync.
    }
  };

  return {
    preview,
    onHandlePointerDown,
    onHandlePointerMove,
    onHandlePointerUp,
    onHandlePointerCancel,
  };
}

export { useTableHandleDrag };
