/** The canvas zoom controls (the floating chrome, top-right): the fit / zoom-out /
 * current / zoom-in buttons. The zoom stands in the view state only — no
 * data, no awareness. `onMouseDown` keeps the default out (a click on the
 * chrome must not steal the pointer into a canvas session). */
import { memo } from "react";

import { Button } from "../../shared/ui";
import { Minus } from "../../shared/ui/icons/Minus";
import { Plus } from "../../shared/ui/icons/Plus";
import { Scan } from "../../shared/ui/icons/Scan";
import { preventDefault } from "../../shared/utils";

const ZoomControls = memo(
  function ZoomControls({
    zoom,
    onStep,
    onReset,
    onFit,
  }: {
    zoom: number;
    onStep: (direction: 1 | -1) => void;
    onReset: () => void;
    onFit: () => void;
  }) {
    const stepOut = () => onStep(-1);
    const stepIn = () => onStep(1);
    return (
      <div data-slot="docblocks/canvas-chrome" className="absolute top-3 right-3 z-50">
        <div
          data-slot="docblocks/zoom-controls"
          role="toolbar"
          aria-label="Canvas zoom"
          className="
            flex items-center gap-0.5 rounded-(--docblocks-radius) border border-(--docblocks-formatbar-border-color)
            bg-(--docblocks-formatbar-background) p-1 text-(--docblocks-text-color)
            shadow-(--docblocks-formatbar-shadow)
          "
          onMouseDown={preventDefault}
        >
          <Button variant="ghost" size="icon" aria-label="Fit to screen" onClick={onFit}>
            <Scan className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Zoom out" onClick={stepOut}>
            <Minus className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" aria-label="Reset zoom" onClick={onReset}>
            {/* The fixed-width display (the widest stand — the 3 digits
              + the % — the zoom's 25–400% range stands no 4-digit
              value): the percentage's change never reflows the row —
              the fit / the zoom out / the zoom in buttons stand put
              over the zoom change. The width stands in ch (the font's
              digit width over tabular-nums), so a consumer's font
              stand scales it without a reflow. */}
            <span className="w-[5ch] text-center tabular-nums">{Math.round(zoom * 100)}%</span>
          </Button>
          <Button variant="ghost" size="icon" aria-label="Zoom in" onClick={stepIn}>
            <Plus className="size-4" />
          </Button>
        </div>
      </div>
    );
    // `onReset` stands an inline arrow (fresh per render, the behavior is
    // constant — the zoom's reset): the zoom and the stable step / fit
    // callbacks are the render inputs (the session's pointermoves stand
    // the chrome).
  },
  (prev, next) => prev.zoom === next.zoom && prev.onStep === next.onStep && prev.onFit === next.onFit
);

export { ZoomControls };
