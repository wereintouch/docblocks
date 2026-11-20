/** The drill-down's `i / N` indicator: the small chip at the click point
 * that names the selected candidate's position in the stack and the stack's
 * size (the wrap is unreadable without it). Transient view state — the chip
 * fades after the short window and stands a fresh cycle's stand again; the
 * pointer never reaches it. */
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";

import { useEffect } from "react";

import { useCanvasViewportStore } from "../viewport";
import { CYCLE_INDICATOR_FADE_MS } from "./canvas-hit-config";

function CanvasCycleIndicator() {
  const { t } = useTranslation("canvas");
  const store = useCanvasViewportStore();
  const indicator = useStore(store, (state) => state.cycleIndicator);
  useEffect(() => {
    if (indicator === null) return;
    const handle = setTimeout(() => store.getState().setCycleIndicator(null), CYCLE_INDICATOR_FADE_MS);
    return () => clearTimeout(handle);
  }, [indicator, store]);
  if (indicator === null) return null;
  return (
    <div
      data-slot="docblocks/canvas-cycle-indicator"
      data-index={indicator.index}
      data-count={indicator.count}
      role="status"
      aria-label={t("cycle.indicatorLabel", { index: indicator.index, count: indicator.count })}
      className="
        pointer-events-none absolute z-50 translate-x-3 translate-y-3 rounded-(--docblocks-radius) border
        border-(--docblocks-canvas-group-border-color) bg-(--docblocks-page-card-background) px-1.5 py-0.5
        text-(length:--docblocks-font-size) text-(--docblocks-text-color)
      "
      style={{
        left: `calc(50% + ${indicator.point.x}px)`,
        top: `calc(50% + ${indicator.point.y}px)`,
      }}
    >
      {t("cycle.indicator", { index: indicator.index, count: indicator.count })}
    </div>
  );
}

export { CanvasCycleIndicator };
