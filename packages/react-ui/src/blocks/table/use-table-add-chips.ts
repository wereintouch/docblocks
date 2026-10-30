/** The table's add-row / add-column chips' drag: the chip's press + drag
 * (the live count's preview — the ghost rows / columns for a positive
 * count, the dimmed last ones for a negative), the release (the count's
 * appends or the last-count removals in one transact — one undo step, one
 * wire update; a concurrent structural change invalidates the drop — the
 * stale guard, the handle's contract — no command, the rows resync), and
 * the cancel. A non-drag press stands the click path (the chip's onClick
 * adds one) — the drag's release suppresses the capture's click. The
 * preview's state stands in the view (the chips' ghost / dimmed rows /
 * columns). */
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

import type { BlockId, Doc, TableBlock as TableBlockType } from "docblocks-core";

import type { AddChipSession, ColumnResizeSession, HandleKind, TableHandleSession } from "./models";
import { DRAG_THRESHOLD } from "./models";
import { addDragCount, sameSequence } from "./utils";

interface TableAddChipsDeps {
  /** The add chip's drag session. */
  addSessionRef: RefObject<AddChipSession | null>;
  /** The handle's drag session (the guard — a press starts at most one
   * session at a time). */
  sessionRef: RefObject<TableHandleSession | null>;
  /** The seam's resize session (the guard). */
  resizeSessionRef: RefObject<ColumnResizeSession | null>;
  /** The click that follows the drag's release (the chip's onClick skips
   * it). */
  addDragClickRef: RefObject<boolean>;
  setAddPreview: (preview: { kind: HandleKind; count: number } | null) => void;
  doc: Doc;
  /** The table's row ids (the press-time snapshot). */
  rows: BlockId[];
  /** The table block (the column order + the column widths' snapshot). */
  block: TableBlockType;
  /** The table's id (the insert/remove's commit). */
  id: BlockId;
}

function useTableAddChips({
  addSessionRef,
  sessionRef,
  resizeSessionRef,
  addDragClickRef,
  setAddPreview,
  doc,
  rows,
  block,
  id,
}: TableAddChipsDeps) {
  const onAddChipPointerDown = (kind: HandleKind) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (
      event.button !== 0 ||
      addSessionRef.current !== null ||
      sessionRef.current !== null ||
      resizeSessionRef.current !== null
    )
      return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    addSessionRef.current = {
      kind,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
      rows: [...rows],
      cols: block.columnOrder.length,
      widths: block.attrs?.columnWidths ?? null,
    };
  };

  const onAddChipPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = addSessionRef.current;
    if (session === null) return;
    const dx = event.clientX - session.startX;
    const dy = event.clientY - session.startY;
    if (!session.dragging && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
      session.dragging = true;
    }
    if (!session.dragging) return;
    const total = session.kind === "row" ? session.rows.length : session.cols;
    const delta = session.kind === "row" ? dy : dx;
    setAddPreview({ kind: session.kind, count: addDragCount(session.kind, total, delta) });
  };

  const onAddChipPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = addSessionRef.current;
    addSessionRef.current = null;
    setAddPreview(null);
    if (session === null) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!session.dragging) return; // the click path (the chip's onClick) adds one
    // The drag's release: whatever the commit's outcome (the count's
    // commit, the zero-count no-op, the stale guard's rejection), the
    // capture's click stands the drag, not a new press — suppress it.
    addDragClickRef.current = true;
    commitAddDrag(session, event.clientX, event.clientY);
  };

  const onAddChipPointerCancel = () => {
    addSessionRef.current = null;
    setAddPreview(null);
  };

  /**
   * The chip drag's release commit: the count's appends (at the end) or
   * the last-count removals in one transact (one undo step, one wire
   * update); a concurrent structural change invalidates the drop (the
   * stale guard, the handle's contract) — no command, the rows resync.
   */
  const commitAddDrag = (session: AddChipSession, clientX: number, clientY: number) => {
    const total = session.kind === "row" ? session.rows.length : session.cols;
    const delta = session.kind === "row" ? clientY - session.startY : clientX - session.startX;
    const count = addDragCount(session.kind, total, delta);
    if (count === 0) return;
    const live = doc.getBlock(id);
    if (live === null || live.type !== "table") return;
    if (!sameSequence(doc.getChildren(id), session.rows)) return;
    if (live.columnOrder.length !== session.cols) return;
    if (session.kind === "column" && !sameSequence(live.attrs?.columnWidths ?? [], session.widths ?? [])) return;
    try {
      doc.transact(() => {
        const current = doc.getBlock(id);
        if (current === null || current.type !== "table") return;
        if (count > 0) {
          for (let i = 0; i < count; i++) {
            if (session.kind === "row") doc.insertTableRow(id);
            else doc.insertTableColumn(id);
          }
        } else {
          for (let i = 0; i < -count; i++) {
            if (session.kind === "row") {
              const rowId = session.rows[session.rows.length - 1 - i];
              if (rowId !== undefined) doc.removeTableRow(id, rowId);
            } else {
              doc.removeTableColumn(id, session.cols - 1 - i);
            }
          }
        }
      });
    } catch {
      // A rejected command (a concurrent structural change won the race):
      // the doc stands as-is, the preview stands the doc's structure.
    }
  };

  return {
    onAddChipPointerDown,
    onAddChipPointerMove,
    onAddChipPointerUp,
    onAddChipPointerCancel,
  };
}

export { useTableAddChips };
