/** The database block's bottom-edge height handle. */
import { useTranslation } from "react-i18next";

import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

interface DatabaseResizeHandleProps {
  height: number;
  minHeight: number;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}

function DatabaseResizeHandle({
  height,
  minHeight,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onKeyDown,
}: DatabaseResizeHandleProps) {
  const { t } = useTranslation("database");
  return (
    <div
      data-slot="docblocks/database-resize"
      role="slider"
      aria-orientation="vertical"
      aria-valuemin={minHeight}
      aria-valuenow={Math.round(height)}
      aria-label={t("resizeHeight")}
      tabIndex={0}
      className="
        absolute inset-x-0 bottom-0 z-10 flex h-2 cursor-row-resize items-end justify-center opacity-0
        transition-opacity outline-none
        group-hover:opacity-100
        focus-visible:opacity-100
      "
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={onKeyDown}
    >
      <div className="mb-0.5 h-0.5 w-10 rounded-full bg-(--docblocks-divider-border-color)" />
    </div>
  );
}

export { DatabaseResizeHandle };
