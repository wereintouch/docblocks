/**
 * The canvas frame's renderer: the frame's boundary — the rectangle that
 * defines the region the page-frame block renders. The CanvasItem's wrapper
 * carries the geometry + the selection + the move/resize preview; the box
 * stands the container's thin rounded border (the selection's color on the
 * selection) over the canvas's own background. The frame renders the
 * boundary only — no content copy: the canvas's own figures stand behind the
 * transparent box (the canvas frame is a region marker, not a window), and
 * the content's mirror (the surface's children clipped to the frame's
 * region) stands on the page-frame block's side (FramePageBlock). The
 * frame's title chip (the container's idiom) stands over the shared
 * CanvasTitleChip.
 */
import { useTranslation } from "react-i18next";

import type { CSSProperties } from "react";

import type { BlockId } from "docblocks-core";

import { PlaceholderBlock } from "../blocks/PlaceholderBlock";
import { useBlock } from "../hooks";
import { useBlockContext } from "../shared/providers/block-context";
import { CanvasTitleChip } from "./CanvasTitleChip";

function FrameBlock({ id, selected = false }: { id: BlockId; selected?: boolean }) {
  const { t } = useTranslation("canvas");
  const { parentType } = useBlockContext();
  const block = useBlock(id);
  if (parentType !== "surface" || block === undefined || block.type !== "frame") {
    // The page context (the page-frame block's window is the page's stand)
    // and the gone block: the lenient placeholder.
    return <PlaceholderBlock type="frame" />;
  }
  const selectedColor = "var(--docblocks-canvas-selection-border-color)";
  const ringColor = selected ? selectedColor : "var(--docblocks-canvas-group-border-color)";
  const boxStyle: CSSProperties = {
    // The boundary's border (the container's thin rounded border — the
    // selection's color on the selection). The box is transparent: the
    // canvas's own figures stand behind it (the frame is a region marker,
    // not a window's content).
    boxShadow: `inset 0 0 0 1px ${ringColor}`,
    // The selection's outline (the token's width — the shared stand over
    // the canvas items' outlines).
    outline: selected ? `var(--docblocks-canvas-selection-border-width) solid ${selectedColor}` : undefined,
    outlineOffset: 1,
  };
  return (
    <div data-slot="docblocks/frame" data-block-id={id} className="h-full w-full">
      <div
        data-slot="docblocks/frame-boundary"
        className="absolute inset-0 rounded-(--docblocks-radius)"
        style={boxStyle}
      />
      <CanvasTitleChip
        id={id}
        title={block.attrs?.title ?? ""}
        selected={selected}
        slot="frame"
        ariaLabel={t("titleChip.frameTitle")}
        restBorderColor="var(--docblocks-canvas-group-border-color)"
      />
    </div>
  );
}

export { FrameBlock };
