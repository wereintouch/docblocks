/**
 * The connector's label chip — the shared shell behind the display and the
 * inline edit. A rounded box of the theme's
 * own background (opaque — it masks the line behind the label), a 1px frame
 * in the line's own color (the `strokeColor` data; the default line token
 * when no data color stands), at the line's midpoint (the world's space —
 * it scales with the zoom, like the line). The stand is constant in every
 * state (unselected / selected / edit). The display chip is pointer-
 * transparent (a double-click passes through to the line's hit path and
 * reopens the edit); the edit stands the same shell over the input (the
 * draft). The selection's emphasis stands the frame too (the frame's color
 * is the caller's `stroke` — the selected token over the data color).
 */
import { useStore } from "zustand";

import type { CSSProperties } from "react";

import type { BlockId } from "docblocks-core";

import { useEditorContext } from "../../EditorProvider";
import { CONNECTOR_SELECTED_STROKE, CONNECTOR_STROKE } from "../ConnectorLayer";
import { connectorMidpoint } from "../canvas-geometry";

/** The label's font size (the world's units — it scales with the zoom). */
const CONNECTOR_LABEL_FONT_SIZE = 12;

/**
 * The chip's stand (the position at the midpoint, the opaque theme
 * background, the 1px frame, the small corner rounding). `stroke` is the
 * frame's color — the line's effective stroke (the data hex or the token).
 */
export function connectorLabelChipStyle(mid: { x: number; y: number }, stroke: string): CSSProperties {
  return {
    position: "absolute",
    left: `calc(50% + ${mid.x}px)`,
    top: `calc(50% + ${mid.y}px)`,
    transform: "translate(-50%, -50%)",
    boxSizing: "border-box",
    padding: "2px 6px",
    fontSize: CONNECTOR_LABEL_FONT_SIZE,
    lineHeight: 1.2,
    textAlign: "center",
    whiteSpace: "nowrap",
    background: "var(--background)",
    color: "var(--foreground)",
    border: `1px solid ${stroke}`,
    borderRadius: "var(--docblocks-radius, 6px)",
  };
}

/** The display chip: the label's text over the opaque background (pointer-
 * transparent — the line's hit path stands the click / the double-click). */
function ConnectorLabelChip({
  id,
  mid,
  stroke,
  label,
}: {
  /** The connector's id (the `data-connector-label`'s identity). */
  id: string;
  /** The line's midpoint (the surface's local space — the world's origin). */
  mid: { x: number; y: number };
  /** The line's effective stroke (the frame's color). */
  stroke: string;
  /** The committed label (the empty string stands no chip). */
  label: string;
}) {
  return (
    <span
      data-connector-label={id}
      data-slot="docblocks/connector-label-chip"
      style={{ ...connectorLabelChipStyle(mid, stroke), pointerEvents: "none" }}
    >
      {label}
    </span>
  );
}

export { ConnectorLabelChip };

const EMPTY_SELECTED: BlockId[] = [];

/**
 * The connector label chips (the display stand) for a surface's children:
 * every labeled connector's midpoint — the shared chip, the opaque theme
 * background over the line's own frame. The caller's `selectedIds` stand
 * the selected emphasis (the frame's selected token); `skipId` (the edit's
 * connector) stands off (its edit chip stands it). Rendered in the
 * surface's world container (the canvas-world / the page view's canvas
 * div) so the chips stand over the lines (the world's space).
 */
function ConnectorLabelChips({
  children,
  selectedIds = EMPTY_SELECTED,
  skipId = null,
}: {
  /** The surface's children (the connector's siblings — the midpoint's read). */
  children: readonly BlockId[];
  /** The selected ids (the frame's selected-token emphasis). */
  selectedIds?: readonly BlockId[];
  /** The editing connector (the display chip stands off). */
  skipId?: BlockId | null;
}) {
  const { store } = useEditorContext();
  const blocks = useStore(store, (state) => state.blocks);
  return (
    <>
      {children.flatMap((cid) => {
        const block = blocks[cid];
        if (block === undefined || block.type !== "connector" || block.attrs === undefined) return [];
        const label = block.attrs.label ?? "";
        if (label === "" || cid === skipId) return [];
        const mid = connectorMidpoint(block, children, blocks);
        if (mid === null) return [];
        const selected = selectedIds.includes(cid);
        const stroke = selected
          ? CONNECTOR_SELECTED_STROKE
          : block.attrs.strokeColor === undefined || block.attrs.strokeColor === "none"
            ? CONNECTOR_STROKE
            : block.attrs.strokeColor;
        return [<ConnectorLabelChip key={cid} id={cid} mid={mid} stroke={stroke} label={label} />];
      })}
    </>
  );
}

export { ConnectorLabelChips };
