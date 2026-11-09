/**
 * The connector's label chip — the shared shell behind the display and the
 * inline edit. A rounded box of the theme's
 * own background (opaque — it masks the line behind the label), a frame in
 * the line's own color (the `strokeColor` data; the default line token
 * when no data color stands) over the line's own stand (the frame's width
 * stands the line's effective width — the `strokeWidth` attr + the
 * selection's bump — and its style stands the line's `strokeStyle`: solid
 * / dashed / dotted), at the line's midpoint (the world's space — it
 * scales with the zoom, like the line). The stand is constant in every
 * state (unselected / selected / edit). The display chip is pointer-
 * transparent (a double-click passes through to the line's hit path and
 * reopens the edit); the edit stands the same shell over the input (the
 * draft). The selection's emphasis stands the frame too (the frame's color
 * is the caller's `stroke` — the selected token over the data color).
 */
import type { CSSProperties } from "react";

/** The label's font size (the world's units — it scales with the zoom). */
const CONNECTOR_LABEL_FONT_SIZE = 12;

/** The line's stroke style stands the chip's frame's border style (the
 * CSS mapping: the dash / the dot stand the dashed / the dotted stand). */
const CHIP_BORDER_STYLE: Record<"solid" | "dash" | "dot", "solid" | "dashed" | "dotted"> = {
  solid: "solid",
  dash: "dashed",
  dot: "dotted",
};

/**
 * The chip's stand (the position at the midpoint, the opaque theme
 * background, the frame over the line's own stand, the small corner
 * rounding). `stroke` is the frame's color — the line's effective stroke
 * (the data hex or the token); `width` stands the line's effective width
 * (canvas px — the frame's thickness over the zoom); `lineStyle` stands
 * the line's `strokeStyle` (the frame's dash / the dot's stand).
 */
function connectorLabelChipStyle(
  mid: { x: number; y: number },
  stroke: string,
  width = 1,
  lineStyle: "solid" | "dash" | "dot" = "solid"
): CSSProperties {
  return {
    position: "absolute",
    left: `calc(50% + ${mid.x}px)`,
    top: `calc(50% + ${mid.y}px)`,
    transform: "translate(-50%, -50%)",
    boxSizing: "border-box",
    padding: "3px 8px",
    fontSize: CONNECTOR_LABEL_FONT_SIZE,
    lineHeight: 1.2,
    textAlign: "center",
    whiteSpace: "nowrap",
    background: "var(--background)",
    color: "var(--foreground)",
    border: `${width}px ${CHIP_BORDER_STYLE[lineStyle]} ${stroke}`,
    borderRadius: "var(--docblocks-radius, 6px)",
  };
}

/** The display chip: the label's text over the opaque background (pointer-
 * transparent — the line's hit path stands the click / the double-click). */
function ConnectorLabelChip({
  id,
  mid,
  stroke,
  width,
  lineStyle,
  label,
}: {
  /** The connector's id (the `data-connector-label`'s identity). */
  id: string;
  /** The line's midpoint (the surface's local space — the world's origin). */
  mid: { x: number; y: number };
  /** The line's effective stroke (the frame's color). */
  stroke: string;
  /** The line's effective width (the frame's thickness, canvas px). */
  width: number;
  /** The line's `strokeStyle` (the frame's border's style). */
  lineStyle: "solid" | "dash" | "dot";
  /** The committed label (the empty string stands no chip). */
  label: string;
}) {
  return (
    <span
      data-connector-label={id}
      data-slot="docblocks/connector-label-chip"
      style={{ ...connectorLabelChipStyle(mid, stroke, width, lineStyle), pointerEvents: "none" }}
    >
      {label}
    </span>
  );
}

export { ConnectorLabelChip };

export { connectorLabelChipStyle };
