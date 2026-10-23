/** The canvas zoom controls (the floating chrome, top-right): the zoom-out /
 * current / zoom-in buttons. The zoom stands in the view state only — no
 * data, no awareness. `onMouseDown` keeps the default out (a click on the
 * chrome must not steal the pointer into a canvas session). */
import { memo } from "react";

import { Button } from "../../shared/ui";
import { Minus } from "../../shared/ui/icons/Minus";
import { Plus } from "../../shared/ui/icons/Plus";

const ZoomControls = memo(
  function ZoomControls({
    zoom,
    onStep,
    onReset,
  }: {
    zoom: number;
    onStep: (direction: 1 | -1) => void;
    onReset: () => void;
  }) {
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
          onMouseDown={(event) => event.preventDefault()}
        >
          <Button variant="ghost" size="icon" aria-label="Zoom out" onClick={() => onStep(-1)}>
            <Minus className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" aria-label="Reset zoom" className="min-w-14 tabular-nums" onClick={onReset}>
            {Math.round(zoom * 100)}%
          </Button>
          <Button variant="ghost" size="icon" aria-label="Zoom in" onClick={() => onStep(1)}>
            <Plus className="size-4" />
          </Button>
        </div>
      </div>
    );
    // `onReset` stands an inline arrow (fresh per render, the behavior is
    // constant — the zoom's reset): the zoom and the stable step callback
    // are the render inputs (the session's pointermoves stand the chrome).
  },
  (prev, next) => prev.zoom === next.zoom && prev.onStep === next.onStep
);

export { ZoomControls };
