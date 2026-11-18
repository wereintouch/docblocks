/** The canvas selection's screen-space overlay: the multi-selection's
 * summary rectangle, the marquee rectangle, and the move's drop
 * indicators (the green / red membership icons over the figures' live
 * edges) — the constant on-screen size at any zoom. */
import type { Block } from "docblocks-core";

import { Container } from "../../shared/ui/icons";
import { effectiveGeometry } from "../geometry";
import { canvasToScreen } from "../viewport";
import type { CanvasViewportState } from "../viewport";

function CanvasSelectionOverlay({
  viewport,
  blocks,
  multiSelectionBox,
}: {
  viewport: CanvasViewportState;
  blocks: Record<string, Block>;
  multiSelectionBox: { left: number; top: number; width: number; height: number } | null;
}) {
  return (
    <>
      {multiSelectionBox !== null && viewport.movePreview === null && (
        // The multi-selection's summary rectangle (the union of the
        // selected items' boxes + the on-screen offset, the token's
        // line + fill — screen-space like the marquee, constant at any
        // zoom). The offset is the CSS token (the style's calc reads
        // it — the px stand no literal here).
        <div
          data-slot="docblocks/canvas-multi-selection"
          className="
            pointer-events-none absolute z-30 border-(length:--docblocks-canvas-selection-border-width)
            border-(--docblocks-canvas-selection-border-color) bg-(--docblocks-canvas-selection-fill)
          "
          style={{
            left: `calc(50% + ${canvasToScreen({ x: multiSelectionBox.left, y: multiSelectionBox.top }, viewport.zoom, viewport.pan).x}px - var(--docblocks-canvas-selection-box-offset))`,
            top: `calc(50% + ${canvasToScreen({ x: multiSelectionBox.left, y: multiSelectionBox.top }, viewport.zoom, viewport.pan).y}px - var(--docblocks-canvas-selection-box-offset))`,
            width: `calc(${multiSelectionBox.width * viewport.zoom}px + 2 * var(--docblocks-canvas-selection-box-offset))`,
            height: `calc(${multiSelectionBox.height * viewport.zoom}px + 2 * var(--docblocks-canvas-selection-box-offset))`,
          }}
        />
      )}
      {viewport.marqueeRect !== null && (
        <div
          data-slot="docblocks/canvas-marquee"
          className="
            pointer-events-none absolute z-40 border-(length:--docblocks-canvas-selection-border-width)
            border-(--docblocks-canvas-selection-border-color) bg-(--docblocks-canvas-selection-fill)
          "
          style={{
            left: `calc(50% + ${viewport.marqueeRect.left}px)`,
            top: `calc(50% + ${viewport.marqueeRect.top}px)`,
            width: viewport.marqueeRect.width,
            height: viewport.marqueeRect.height,
          }}
        />
      )}
      {viewport.dropIndicators !== null &&
        viewport.dropIndicators.map((indicator) => {
          const figure = blocks[indicator.id];
          if (figure === undefined) return null;
          const base = effectiveGeometry(figure);
          const mv = viewport.movePreview;
          // The icon stands above the figure's live top edge (the move
          // preview's delta, the screen space — the on-screen size stands
          // at any zoom).
          const screen = canvasToScreen(
            { x: base.x + (mv?.dx ?? 0), y: base.y + (mv?.dy ?? 0) - base.h / 2 - 14 },
            viewport.zoom,
            viewport.pan
          );
          const isOut = indicator.kind === "out";
          return (
            <div
              key={`${indicator.id}-${indicator.containerId}`}
              data-slot="docblocks/canvas-drop-indicator"
              data-drop={indicator.kind}
              className="
                pointer-events-none absolute z-40 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center
                justify-center rounded-full
              "
              style={{
                left: `calc(50% + ${screen.x}px)`,
                top: `calc(50% + ${screen.y}px)`,
                background: isOut ? "var(--destructive, #ef4444)" : "var(--docblocks-canvas-connect-color, #16a34a)",
                color: "var(--docblocks-page-card-background, #ffffff)",
              }}
            >
              <Container className="size-4" />
            </div>
          );
        })}
    </>
  );
}
export { CanvasSelectionOverlay };
