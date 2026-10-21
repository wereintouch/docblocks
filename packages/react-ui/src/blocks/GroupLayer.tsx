/**
 * The surface's GROUP layer (the flat marker's outline): for every `group` child, the dashed outline over the
 * members' DERIVED union box (the box is never stored — the members' move
 * IS the group's move, so the outline never goes stale; the in-flight
 * move preview offsets it live). The outline stands in the surface's
 * center-anchor space (the 1x1 overflow-visible svg, the ConnectorLayer's
 * parity), pointer-events none: a subtle dashed line at rest (the group
 * token, theme-following), the selection's cyan over the selected group.
 * The wide transparent hit stroke stands the group's press (the band's
 * drag = the members' move session — the group block itself is never a
 * move target: it carries no geometry).
 */
import { useStore } from "zustand";

import type { ReactNode } from "react";

import type { BlockId } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import type { MovePreview } from "../canvas/viewport-state";
import { useBlock } from "../hooks";
import { groupBoxOf } from "./canvas-geometry";

/** The outline's breath from the members' union edges (canvas px, the
 * zoom-scaled space — the connector's line constants' posture). */
const OUTLINE_OFFSET = 4;
/** The invisible hit stroke's width (canvas px): the wide enough band to
 * click the outline (the connector's hit path's parity). */
const HIT_STROKE_WIDTH = 12;
/** The dashed pattern (canvas px, the zoom-scaled space). */
const DASH = "6 4";
/** The outline's width (canvas px) at rest / over the selected group. */
const REST_STROKE_WIDTH = 1;
const SELECTED_STROKE_WIDTH = 2;

/** The resting outline's color (the muted line, theme-following). */
const REST_STROKE = "var(--docblocks-canvas-group-border-color)";
/** The selected group's outline (the canvas selection's cyan). */
const SELECTED_STROKE = "var(--docblocks-canvas-selection-border-color)";

/**
 * One surface's group outlines. `movePreview` (the in-flight move's
 * rendered preview) offsets the box of the group ANY of whose members
 * moves (the outline follows the drag — the preview's ids are the
 * members, never the group itself).
 */
function GroupLayer({ id, movePreview }: { id: BlockId; movePreview: MovePreview | null }) {
  const { store } = useEditorContext();
  const surface = useBlock(id);
  const blocks = useStore(store, (state) => state.blocks);
  const selection = useStore(store, (state) => state.selection);
  if (surface === undefined || surface.type !== "surface") return null;
  const children = surface.children ?? [];
  const rects: ReactNode[] = [];
  for (const childId of children) {
    const block = blocks[childId];
    if (block === undefined || block.type !== "group") continue;
    const siblings = children;
    const box = groupBoxOf(block.attrs?.members, siblings, blocks);
    if (box === null) continue; // no effective member: the outline stands nothing
    let { x, y } = box;
    if (movePreview !== null) {
      // The live offset: the group's members in the preview stand the
      // group's own offset (the preview's ids are the members).
      if ((block.attrs?.members ?? []).some((member) => movePreview.ids.includes(member))) {
        x += movePreview.dx;
        y += movePreview.dy;
      }
    }
    const selected = selection?.kind === "blocks" && selection.ids.includes(childId);
    const stroke = selected ? SELECTED_STROKE : REST_STROKE;
    const strokeWidth = selected ? SELECTED_STROKE_WIDTH : REST_STROKE_WIDTH;
    const left = x - box.w / 2 - OUTLINE_OFFSET;
    const top = y - box.h / 2 - OUTLINE_OFFSET;
    const width = box.w + 2 * OUTLINE_OFFSET;
    const height = box.h + 2 * OUTLINE_OFFSET;
    rects.push(
      <g key={childId} data-slot="docblocks/canvas-group" data-block-id={childId}>
        <rect
          data-slot="docblocks/canvas-group-outline"
          data-selected={selected || undefined}
          x={left}
          y={top}
          width={width}
          height={height}
          rx={4}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeDasharray={DASH}
          pointerEvents="none"
        />
        {/* The group's hit band (the wide transparent stroke): the press
            selects the group + starts the members' move session. */}
        <rect
          data-group-hit={childId}
          x={left}
          y={top}
          width={width}
          height={height}
          fill="none"
          stroke="transparent"
          strokeWidth={HIT_STROKE_WIDTH}
          pointerEvents="stroke"
          style={{ cursor: "move" }}
        />
      </g>
    );
  }
  if (rects.length === 0) return null;
  return (
    <svg
      data-slot="docblocks/canvas-group-layer"
      className="pointer-events-none absolute top-1/2 left-1/2 overflow-visible"
      width={1}
      height={1}
    >
      {rects}
    </svg>
  );
}

export { GroupLayer };
