/**
 * The canvas container's renderer (the reworked group): the rectangle's thin neutral border + the title chip at the
 * top-left (the shared CanvasTitleChip — the chip's double-click enters
 * the inline edit, the selected title-less container stands the set-title
 * menu). The interior is pointer-transparent (the members stand z-above
 * and clickable); the border's wide hit band and the title chip are the
 * press targets (they select the container). The selected border stands
 * the canvas selection's color (the wrapper's tint stands off — the box
 * is the members' area). Pure view state: the doc writes on the commit
 * only.
 */
import type { Block, BlockId } from "docblocks-core";

import { CanvasTitleChip } from "./CanvasTitleChip";

type GROUP_BLOCK_VIEW = Extract<Block, { type: "group" }>;
/** The border's wide hit band (px, both sides — the thin line's reach). */
const BORDER_HIT_PX = 6;

function GroupBlock({ id, block, selected }: { id: BlockId; block: GROUP_BLOCK_VIEW; selected: boolean }) {
  const title = block.attrs?.title ?? "";

  const selectedColor = "var(--docblocks-canvas-selection-border-color)";
  const borderColor = selected ? selectedColor : "var(--docblocks-table-border-color)";

  // The border's wide hit band's half (px): each of the four strips stands
  // the edge straddled (the half in, the half out).
  const HIT_HALF = BORDER_HIT_PX / 2;

  return (
    <div className="pointer-events-none h-full w-full">
      {/* The visual border (the 1px ring + the selected outline):
          pointer-TRANSPARENT — the interior stands the members' press (a
          full-box hit band would shield the members under the container). */}
      <div
        className="absolute rounded-(--docblocks-radius)"
        style={{
          inset: 0,
          boxShadow: `inset 0 0 0 1px ${borderColor}`,
          outline: selected ? `1px solid ${selectedColor}` : undefined,
          outlineOffset: 1,
        }}
      />
      {/* The border's wide hit bands (the press target — the ring ONLY, the
          interior stays pointer-transparent so the members stand their own
          press): four transparent strips, each straddling one edge. */}
      <div
        data-slot="docblocks/group-border"
        style={{
          pointerEvents: "auto",
          cursor: "default",
          position: "absolute",
          left: -HIT_HALF,
          right: -HIT_HALF,
          top: -HIT_HALF,
          height: BORDER_HIT_PX,
        }}
      />
      <div
        data-slot="docblocks/group-border"
        style={{
          pointerEvents: "auto",
          cursor: "default",
          position: "absolute",
          left: -HIT_HALF,
          right: -HIT_HALF,
          bottom: -HIT_HALF,
          height: BORDER_HIT_PX,
        }}
      />
      <div
        data-slot="docblocks/group-border"
        style={{
          pointerEvents: "auto",
          cursor: "default",
          position: "absolute",
          top: -HIT_HALF,
          bottom: -HIT_HALF,
          left: -HIT_HALF,
          width: BORDER_HIT_PX,
        }}
      />
      <div
        data-slot="docblocks/group-border"
        style={{
          pointerEvents: "auto",
          cursor: "default",
          position: "absolute",
          top: -HIT_HALF,
          bottom: -HIT_HALF,
          right: -HIT_HALF,
          width: BORDER_HIT_PX,
        }}
      />
      <CanvasTitleChip
        id={id}
        title={title}
        selected={selected}
        slot="group"
        ariaLabel="Container title"
        restBorderColor="var(--docblocks-table-border-color)"
      />
    </div>
  );
}

export type { GROUP_BLOCK_VIEW as GroupBlockView };
export { GroupBlock };
