/**
 * The canvas frame's renderer: the viewport window (the "camera") into the
 * frame's own surface's content. The CanvasItem's wrapper carries the
 * geometry + the selection + the move/resize preview; inside it: the full
 * box (the true window — overflow hidden) over the canvas's own background
 * (the background's color + the dot grid phase-aligned to the world's
 * grid — the seamless canvas continuation that hides the content under
 * the window) and the container's thin rounded border (the selection's
 * color on the selection). The window's content is the inert clipped
 * copy of the surface's children (FrameWindowContent) at the window's
 * offset (the surface's world origin over the box's local point): moving
 * the frame pans the window — the content stands at its world coordinates
 * (the offset re-derives over the effective geometry — the committed box
 * plus the move/resize preview) while the box slides. The frame's title
 * chip (the container's idiom) stands over the shared CanvasTitleChip.
 * The frame-chain's cycle guard: a frame rendered inside another frame's
 * window carries the chain's ids and excludes the chain + itself from its
 * window's content (the chain grows strictly down the nesting — the
 * recursion is finite, no depth limit needed).
 */
import type { CSSProperties } from "react";

import type { BlockId } from "docblocks-core";

import { PlaceholderBlock } from "../blocks/PlaceholderBlock";
import { useBlock } from "../hooks";
import { useBlockContext } from "../shared/providers/block-context";
import type { MovePreview } from "./viewport";
import { effectiveGeometry, frameDotBackground, frameWindowOffset } from "./geometry";
import type { Box } from "./geometry";
import { CanvasTitleChip } from "./CanvasTitleChip";
import { FrameWindowContent } from "./FrameWindowContent";

/** The frame chain's stand of a direct surface child (no window above).
 * The stable module constant stands the default — the memo's identity
 * comparison bails over the resting items. */
const EMPTY_FRAME_CHAIN: ReadonlySet<BlockId> = new Set();

function FrameBlock({
  id,
  movePreview = null,
  resizeBox = null,
  selected = false,
  frameChain = EMPTY_FRAME_CHAIN,
}: {
  id: BlockId;
  /** The in-flight move preview over this frame (the wrapper's offset). */
  movePreview?: MovePreview | null;
  /** The in-flight resize preview (the live box). */
  resizeBox?: Box | null;
  selected?: boolean;
  /** The frames this frame renders inside of (the window's cycle guard). */
  frameChain?: ReadonlySet<BlockId>;
}) {
  const { parentId, parentType } = useBlockContext();
  const block = useBlock(id);
  if (parentType !== "surface" || block === undefined || block.type !== "frame") {
    // The page context (the page-frame block's window is the page's stand)
    // and the gone block: the lenient placeholder.
    return <PlaceholderBlock type="frame" />;
  }
  // The effective geometry (the committed box + the in-flight move/resize
  // preview): the window's offset and the dot grid's phase stand on it, so
  // the box slides over the still world content over the preview.
  const committed = effectiveGeometry(block);
  const effective: Box = {
    x: (resizeBox?.x ?? committed.x) + (movePreview?.dx ?? 0),
    y: (resizeBox?.y ?? committed.y) + (movePreview?.dy ?? 0),
    w: resizeBox?.w ?? committed.w,
    h: resizeBox?.h ?? committed.h,
  };
  const offset = frameWindowOffset(effective);
  const selectedColor = "var(--docblocks-canvas-selection-border-color)";
  const ringColor = selected ? selectedColor : "var(--docblocks-canvas-group-border-color)";
  const boxStyle: CSSProperties = {
    backgroundColor: "var(--docblocks-canvas-background)",
    ...frameDotBackground(effective.x - effective.w / 2, effective.y - effective.h / 2),
    boxShadow: `inset 0 0 0 1px ${ringColor}`,
    outline: selected ? `1px solid ${selectedColor}` : undefined,
    outlineOffset: 1,
  };
  // The frame-chain's cycle guard: the window's content stands the
  // surface's children minus the chain ∪ {self}.
  return (
    <div data-slot="docblocks/frame" data-block-id={id} className="h-full w-full">
      <div data-slot="docblocks/frame-window" className="absolute inset-0 overflow-hidden rounded-(--docblocks-radius)" style={boxStyle}>
        <FrameWindowContent
          surfaceId={parentId}
          offset={offset}
          excludedIds={[...frameChain, id]}
          frameChain={new Set([...frameChain, id])}
        />
      </div>
      <CanvasTitleChip
        id={id}
        title={block.attrs?.title ?? ""}
        selected={selected}
        slot="frame"
        ariaLabel="Frame title"
        restBorderColor="var(--docblocks-canvas-group-border-color)"
      />
    </div>
  );
}

export { EMPTY_FRAME_CHAIN, FrameBlock };
