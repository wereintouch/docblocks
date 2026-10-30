/** The database grid's column-seam resize: the header cell's right-edge
 * seam's press + drag (the live preview overrides the dragged column's
 * width — no bridge write until the release commits the width), the
 * release (the clamped width commits when it changed — one `updateBlock`,
 * one undo step; the untouched columns stand their measured rendered
 * width, the WYSIWYG lock; a 0 px drag stands a no-op; a stale visible
 * sequence — a peer reordered / hid a column mid-drag — stands no
 * commit), and the cancel. The preview's state stands in the hook (the
 * view reads the dragged column's live width). */
import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import type { BridgeColumn } from "../bridge";
import { DEFAULT_DATABASE_COLUMN_WIDTH_PX, MIN_DATABASE_COLUMN_WIDTH_PX } from "./constants";
import type { ColumnResizeSession } from "./models";

interface GridSeamResizeDeps {
  /** The visible columns (the measured widths' source). */
  columns: BridgeColumn[];
  /** The doc's column widths (the untouched columns' WYSIWYG stand). */
  columnWidths?: number[];
  /** The view's commit (the column widths' `updateBlock`). */
  updateView: (patch: Record<string, unknown>) => void;
}

function useGridSeamResize({ columns, columnWidths, updateView }: GridSeamResizeDeps) {
  // The column resize session (the header cell's right-edge seam).
  const [resizePreview, setResizePreview] = useState<{ col: number; width: number } | null>(null);
  const resizeSession = useRef<ColumnResizeSession | null>(null);

  /** The seam press: starts the resize session (the native click / the
   *  column-drag gesture is suppressed — the seam's press stands its own
   *  session). */
  const onSeamPointerDown = (col: number) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || resizeSession.current !== null) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const header = event.currentTarget.closest<HTMLElement>("[data-slot='docblocks/database-header-cell']");
    const startWidth =
      header !== null && header.offsetWidth > 0 ? header.offsetWidth : DEFAULT_DATABASE_COLUMN_WIDTH_PX;
    resizeSession.current = {
      col,
      startX: event.clientX,
      startWidth,
      width: startWidth,
      visible: columns.map((entry) => entry.id),
    };
  };

  const onSeamPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = resizeSession.current;
    if (session === null) return;
    session.width = Math.max(
      Math.round(session.startWidth + (event.clientX - session.startX)),
      MIN_DATABASE_COLUMN_WIDTH_PX
    );
    setResizePreview({ col: session.col, width: session.width });
  };

  /** The seam release: the clamped width commits when it changed (one
   *  `updateBlock`, one undo step) — the untouched columns stand their
   *  measured rendered width (the WYSIWYG lock); a 0 px drag stands a
   *  no-op (no wire traffic), and a stale visible sequence (a peer
   *  reordered / hid a column mid-drag) stands no commit. */
  const onSeamPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = resizeSession.current;
    resizeSession.current = null;
    setResizePreview(null);
    if (session === null) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (session.width === session.startWidth) return;
    if (!columns.map((entry) => entry.id).every((value, i) => session.visible[i] === value)) return;
    const cells = Array.from(document.querySelectorAll<HTMLElement>("[data-slot='docblocks/database-header-cell']"));
    const next = columns.map((_, i) => {
      if (i === session.col) return session.width;
      const measured = cells[i]?.offsetWidth ?? 0;
      const set = columnWidths?.[i];
      const stand = set !== undefined && set > 0 ? set : measured > 0 ? measured : DEFAULT_DATABASE_COLUMN_WIDTH_PX;
      return Math.max(Math.round(stand), MIN_DATABASE_COLUMN_WIDTH_PX);
    });
    updateView({ columnWidths: next });
  };

  const onSeamPointerCancel = () => {
    resizeSession.current = null;
    setResizePreview(null);
  };

  return {
    resizePreview,
    onSeamPointerDown,
    onSeamPointerMove,
    onSeamPointerUp,
    onSeamPointerCancel,
  };
}

export { useGridSeamResize };
