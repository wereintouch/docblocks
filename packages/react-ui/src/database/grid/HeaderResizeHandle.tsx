/** The grid's header-row resize handle: the full-width strip over the
 *  header row's bottom edge (it spans the header's track row — the header
 *  cells carry their own explicit placement, so the strip stands the
 *  overlay of the same row). The press-drag session is the hook's stand;
 *  the read-only modes render no handle (the height itself still
 *  applies). */
import { useTranslation } from "react-i18next";

import type { PointerEvent as ReactPointerEvent } from "react";

import { cn } from "../../shared/ui/cn";

interface HeaderResizeHandleProps {
  /** The session is live (the line stands visible off the pointer's hover). */
  resizing: boolean;
  /** The double-click's reset commit (the default height's return) — the
   *  editable's stand (the handle renders over the write target's stand). */
  onDoubleClickReset?: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: () => void;
}

/** The header's bottom edge: the 6 px strip straddles the border (the
 *  seam idiom — the pointer over the edge stands the stable row-resize).
 *  The double click over the strip stands the height's reset (the default
 *  height's return — the press's no-op's parity over the drag's release). */
function HeaderResizeHandle({
  resizing,
  onDoubleClickReset,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: HeaderResizeHandleProps) {
  const { t } = useTranslation("database");
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={t("header.resizeHeight")}
      data-slot="docblocks/database-header-resize"
      className={cn(
        `
          z-10 col-span-full row-start-1 flex h-1.5 translate-y-1/2 cursor-row-resize items-center self-end opacity-0
          transition-opacity
          hover:opacity-100
        `,
        resizing && "opacity-100"
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={onDoubleClickReset}
    >
      <div data-slot="docblocks/database-header-resize-line" className="h-0.5 w-full rounded bg-(--muted-foreground)" />
    </div>
  );
}

export { HeaderResizeHandle };
