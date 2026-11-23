/**
 * The embed's bottom-edge's resize handle (the stretch's stand): the hover /
 * focus's reveal (the grip's bar), the drag's live's height + the doc's
 * write over the rest (the `height` attr's stand, the panes' shared view),
 * and the keyboard's arrows' nudge. The read-only's stand: the handle
 * stands absent (the editing surface's gate).
 */
import { useTranslation } from "react-i18next";

import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

import { useEditorContext } from "../editor-provider";

interface EmbedResizeHandleProps {
  height: number | null;
  tokenMin: number;
  onPointerDown: (event: ReactPointerEvent) => void;
  onPointerMove: (event: ReactPointerEvent) => void;
  onPointerUp: (event: ReactPointerEvent) => void;
  onKeyDown: (event: ReactKeyboardEvent) => void;
}

function EmbedResizeHandle({
  height,
  tokenMin,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onKeyDown,
}: EmbedResizeHandleProps) {
  const { t } = useTranslation("blocks");
  const { viewMode } = useEditorContext();
  if (viewMode) return null;
  return (
    <div
      data-slot="docblocks/embed-resize"
      role="slider"
      aria-orientation="vertical"
      aria-valuemin={tokenMin}
      aria-valuenow={Math.max(height ?? tokenMin, tokenMin)}
      aria-label={t("embed.resizeHeight")}
      tabIndex={0}
      className="
        absolute inset-x-0 bottom-0 z-10 flex h-2 cursor-row-resize items-end justify-center opacity-0
        transition-opacity outline-none
        group-focus-within:opacity-100
        group-hover:opacity-100
      "
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      <div className="mb-0.5 h-0.5 w-10 rounded-full bg-(--docblocks-divider-border-color)" />
    </div>
  );
}

export { EmbedResizeHandle };
