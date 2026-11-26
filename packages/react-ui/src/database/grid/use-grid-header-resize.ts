/** The database grid's header-row resize: the full-width handle's press +
 *  drag (the live preview stands the row's height; no commit until the
 *  release), the release (the clamped height commits over the caller's
 *  write stand — the block's attr / the consumer's per-table section
 *  setting; a drag back to the press's height stands a no-op), and the
 *  cancel. The clamp's floor is the auto height measured at the press, so
 *  the header's content never renders clipped. */
import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { MIN_DATABASE_HEADER_HEIGHT_PX } from "./constants";
import { clampDatabaseHeaderHeight, measureDatabaseHeaderHeight } from "./header-height";
import type { GridHeaderResizeSession } from "./models";

interface GridHeaderResizeDeps {
  /** The grid's root (the auto height's measurement scope). */
  tableRef: { current: HTMLDivElement | null };
  /** The resolved stand (the block attr over the section value); undefined
   *  = the auto height. */
  headerHeight?: number;
  /** The release's commit (one write: the block attr / the section value). */
  onCommit: (height: number) => void;
}

function useGridHeaderResize({ tableRef, headerHeight, onCommit }: GridHeaderResizeDeps) {
  // The preview's height (the session's live stand; null = no session).
  const [headerPreview, setHeaderPreview] = useState<number | null>(null);
  const session = useRef<GridHeaderResizeSession | null>(null);

  /** The handle's press: starts the resize session (the native click /
   *  the surrounding gestures are suppressed — the handle stands its own
   *  session). */
  const onHeaderPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || session.current !== null) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const natural = measureDatabaseHeaderHeight(tableRef.current);
    // The auto stand's fallback (the unmeasured grid — the one-line floor).
    const stand = headerHeight ?? Math.max(natural, MIN_DATABASE_HEADER_HEIGHT_PX);
    const startHeight = clampDatabaseHeaderHeight(stand, natural);
    session.current = { startY: event.clientY, startHeight, natural, height: startHeight };
    setHeaderPreview(startHeight);
  };

  const onHeaderPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const live = session.current;
    if (live === null) return;
    live.height = clampDatabaseHeaderHeight(live.startHeight + (event.clientY - live.startY), live.natural);
    setHeaderPreview(live.height);
  };

  /** The handle's release: the clamped height commits when it changed (one
   *  write, one undo step over the block's stand); a drag back to the
   *  press's height stands a no-op (no wire traffic). */
  const onHeaderPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const live = session.current;
    session.current = null;
    setHeaderPreview(null);
    if (live === null) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (live.height === live.startHeight) return;
    onCommit(live.height);
  };

  const onHeaderPointerCancel = () => {
    session.current = null;
    setHeaderPreview(null);
  };

  return { headerPreview, onHeaderPointerDown, onHeaderPointerMove, onHeaderPointerUp, onHeaderPointerCancel };
}

export { useGridHeaderResize };
