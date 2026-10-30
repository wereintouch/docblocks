/** The table's column-seam resize: the seam's press + drag (the live
 * preview overrides the dragged column's width — no wire traffic until the
 * release commits the width), the release (the clamped width commits when
 * it changed — one command, one undo step; a 0 px drag stands a no-op), and
 * the cancel. The preview's state stands in the hook (the view's read of
 * the dragged column's width). */
import { useState } from "react";
import type { MutableRefObject, PointerEvent as ReactPointerEvent } from "react";

import type { BlockId, Doc } from "docblocks-core";

import type { ColumnResizeSession } from "./models";
import { MIN_COLUMN_WIDTH } from "./models";
import { clampColumnWidth } from "./utils";

interface TableSeamResizeDeps {
  /** The doc's column widths (the stored widths, the default fallback). */
  docWidths: number[];
  doc: Doc;
  /** The table's id (the width's commit). */
  id: BlockId;
  /** The seam's resize session (shared with the add chip's + the handle's
   * guards — a press starts at most one session at a time). */
  resizeSessionRef: MutableRefObject<ColumnResizeSession | null>;
}

function useTableSeamResize({ docWidths, doc, id, resizeSessionRef }: TableSeamResizeDeps) {
  const [resizePreview, setResizePreview] = useState<{ col: number; width: number } | null>(null);

  const onSeamPointerDown = (col: number) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || resizeSessionRef.current !== null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const startWidth = docWidths[col - 1] ?? MIN_COLUMN_WIDTH;
    resizeSessionRef.current = { col, startX: event.clientX, startWidth, width: startWidth };
  };

  const onSeamPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = resizeSessionRef.current;
    if (session === null) return;
    session.width = clampColumnWidth(session.startWidth + (event.clientX - session.startX));
    setResizePreview({ col: session.col, width: session.width });
  };

  /**
   * The seam release: the clamped width commits when it changed (one
   * command, one undo step); a 0 px drag stands a no-op (no wire traffic).
   */
  const onSeamPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = resizeSessionRef.current;
    resizeSessionRef.current = null;
    setResizePreview(null);
    if (session === null || session.width === session.startWidth) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    try {
      doc.setTableColumnWidth(id, session.col - 1, session.width);
    } catch {
      // A rejected width (a concurrent structural change won the race):
      // the doc stands as-is, the preview stands the doc's width.
    }
  };

  const onSeamPointerCancel = () => {
    resizeSessionRef.current = null;
    setResizePreview(null);
  };

  /**
   * The add chip's press: starts the drag session (the capture keeps the
   * moves / the release on the chip). No preventDefault — the press's
   * click must stand (the no-drag release's single insert is the click
   * path; the pointerdown's preventDefault would suppress it).
   */

  return {
    resizePreview,
    onSeamPointerDown,
    onSeamPointerMove,
    onSeamPointerUp,
    onSeamPointerCancel,
  };
}

export { useTableSeamResize };
