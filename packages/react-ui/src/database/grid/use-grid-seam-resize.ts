/** The database grid's column-seam resize: the header cell's right-edge
 * seam's press + drag (the live preview locks every column over its
 * rendered width — the flexible columns' stand no live shrink, so only
 * the dragged column moves; no bridge write until the release commits
 * the widths), the release (the clamped width commits when it changed —
 * one `updateBlock`, one undo step; the untouched columns stand their
 * measured rendered width, the WYSIWYG lock — the commit stands the
 * preview's locked layout exactly; a 0 px drag stands a no-op; a stale
 * visible sequence — a peer reordered / hid a column mid-drag — stands
 * no commit), and the cancel. The preview's state stands in the hook (the
 * view's read of the session's locked widths). */
import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import type { BridgeColumn } from "../bridge";
import { DEFAULT_DATABASE_COLUMN_WIDTH_PX, MIN_DATABASE_COLUMN_WIDTH_PX } from "./constants";
import type { GridColumnResizeSession } from "./models";

interface GridSeamResizeDeps {
  /** The visible columns (the measured widths' source). */
  columns: BridgeColumn[];
  /** The doc's column widths (the untouched columns' WYSIWYG stand). */
  columnWidths?: number[];
  /** The view's commit (the column widths' `updateBlock`). */
  updateView: (patch: Record<string, unknown>) => void;
}

function useGridSeamResize({ columns, columnWidths, updateView }: GridSeamResizeDeps) {
  // The column resize session (the header cell's right-edge seam). The
  // preview's widths lock every visible column over its rendered width at
  // the press: the flexible (1fr) columns stand no live shrink over the
  // drag (only the dragged column moves), and the release's commit (the
  // start's measurement) stands the locked layout exactly — no jump.
  const [resizePreview, setResizePreview] = useState<{ col: number; widths: number[] } | null>(null);
  const resizeSession = useRef<GridColumnResizeSession | null>(null);

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
    // The untouched columns' widths over the session's START layout (no
    // preview at the press): the release's WYSIWYG stand reads them. The
    // measurement's scope stands the grid's own container (a page may
    // stand two grids; the foreign's cells' widths stand no stand).
    const scope = event.currentTarget.closest<HTMLElement>("[data-slot='docblocks/database']");
    const cells = Array.from(
      scope?.querySelectorAll<HTMLElement>("[data-slot='docblocks/database-header-cell']") ?? []
    );
    const widthsAtStart = columns.map((_, i) => cells[i]?.offsetWidth ?? 0);
    // The session's locked widths (the preview's source): every column
    // over the same stand the release's commit uses (the stored width,
    // else the start's measurement, else the default — the MIN's floor).
    const widths = columns.map((_, i) => {
      const measured = widthsAtStart[i] ?? 0;
      const set = columnWidths?.[i];
      const stand = set !== undefined && set > 0 ? set : measured > 0 ? measured : DEFAULT_DATABASE_COLUMN_WIDTH_PX;
      return Math.max(Math.round(stand), MIN_DATABASE_COLUMN_WIDTH_PX);
    });
    widths[col] = Math.max(Math.round(startWidth), MIN_DATABASE_COLUMN_WIDTH_PX);
    resizeSession.current = {
      col,
      startX: event.clientX,
      startWidth,
      width: startWidth,
      visible: columns.map((entry) => entry.id),
      widthsAtStart,
      widths,
    };
    setResizePreview({ col, widths });
  };

  const onSeamPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = resizeSession.current;
    if (session === null) return;
    session.width = Math.max(
      Math.round(session.startWidth + (event.clientX - session.startX)),
      MIN_DATABASE_COLUMN_WIDTH_PX
    );
    session.widths[session.col] = session.width;
    setResizePreview({ col: session.col, widths: session.widths });
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
    // The untouched columns' stand reads the session's start measurement
    // (the preview's locked layout's source — the commit stands it
    // exactly). The measurement's scope stands the grid's own container
    // (a page may stand two grids; the foreign's cells' widths stand no
    // stand).
    const next = columns.map((_, i) => {
      if (i === session.col) return session.width;
      const measured = session.widthsAtStart[i] ?? 0;
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
