/** The canvas container / frame title chips over the screen layer: the
 * chips stand above the world's paint order, so a figure that covers the
 * box still leaves the chip visible and clickable; the chip keeps its
 * on-screen size at any zoom (the seat is the block's own frame mapped
 * through the zoom / pan — the chip's offsets resolve against it), and it
 * follows the in-flight move / resize preview and the camera. The chips
 * render only over the viewport's culled-in items. The chip's press
 * stands the container's item press contract (the session's chip branch),
 * the double-click the title's inline edit. The seat itself is
 * pointer-transparent: only the chip catches the press, so the rest of
 * the covered box keeps the press of what lies beneath. */
import { useTranslation } from "react-i18next";

import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

import type { Block, BlockId, Selection } from "docblocks-core";

import { CanvasTitleChip } from "../CanvasTitleChip";
import { effectiveGeometry } from "../geometry";
import { canvasToScreen } from "../viewport";
import type { CanvasViewportState } from "../viewport";

/** The chip's seat: the block's live box (the committed geometry over the
 * in-flight previews — the chip rides the moved / resized object). */
function seatBoxOf(
  id: BlockId,
  block: Block,
  viewport: Pick<CanvasViewportState, "movePreview" | "resizePreview">
): { x: number; y: number; w: number; h: number } {
  const resize = viewport.resizePreview;
  if (resize !== null && resize.id === id) return resize.box;
  const base = effectiveGeometry(block);
  const move = viewport.movePreview;
  if (move !== null && move.idSet.has(id)) {
    return { x: base.x + move.dx, y: base.y + move.dy, w: base.w, h: base.h };
  }
  return base;
}

function CanvasTitleChips({
  surfaces,
  blocks,
  visibleIds,
  selection,
  viewport,
  viewMode,
  onChipPress,
  onChipDoubleClick,
}: {
  surfaces: { id: BlockId; children: BlockId[] }[];
  blocks: Record<BlockId, Block>;
  /** The culling's keep set: `null` = no cull. */
  visibleIds: Set<BlockId> | null;
  selection: Selection | null;
  viewport: CanvasViewportState;
  /** The read-only stand (view / published): the chips render inert. */
  viewMode: boolean;
  onChipPress: (id: BlockId, event: ReactPointerEvent<HTMLDivElement>) => void;
  onChipDoubleClick: (id: BlockId, event: ReactMouseEvent<HTMLDivElement>) => void;
}) {
  const { t } = useTranslation("canvas");
  const selectedIds = selection?.kind === "blocks" ? selection.ids : [];
  return (
    <>
      {surfaces.map(({ id: surfaceId, children }) =>
        children.map((childId) => {
          const block = blocks[childId];
          if (block === undefined) return null;
          if (block.type !== "group" && block.type !== "frame") return null;
          const title = block.attrs?.title ?? "";
          const selected = selectedIds.includes(childId);
          // The chip exists for a titled block and for the selected
          // title-less one (the set-title menu's seat); a title-less,
          // unselected block has no chip — the drill-down cycle reaches it.
          if (title === "" && !selected) return null;
          if (visibleIds !== null && !visibleIds.has(childId)) return null;
          const seat = seatBoxOf(childId, block, viewport);
          const screen = canvasToScreen({ x: seat.x, y: seat.y }, viewport.zoom, viewport.pan);
          return (
            <div
              key={`${surfaceId}-${childId}`}
              data-slot="docblocks/canvas-title-chip"
              data-block-id={childId}
              className="absolute z-45"
              style={{
                left: `calc(50% + ${screen.x}px)`,
                top: `calc(50% + ${screen.y}px)`,
                width: seat.w * viewport.zoom,
                height: seat.h * viewport.zoom,
                transform: "translate(-50%, -50%)",
                pointerEvents: "none",
              }}
              onPointerDown={(event) => onChipPress(childId, event)}
              onDoubleClick={(event) => onChipDoubleClick(childId, event)}
            >
              <CanvasTitleChip
                id={childId}
                title={title}
                selected={selected}
                slot={block.type}
                ariaLabel={block.type === "group" ? t("titleChip.containerTitle") : t("titleChip.frameTitle")}
                restBorderColor={
                  block.type === "group"
                    ? "var(--docblocks-table-border-color)"
                    : "var(--docblocks-canvas-group-border-color)"
                }
                interactive={!viewMode}
              />
            </div>
          );
        })
      )}
    </>
  );
}

export { CanvasTitleChips };
