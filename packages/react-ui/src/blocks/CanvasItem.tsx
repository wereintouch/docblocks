import { useStore } from "zustand";

import type { CSSProperties, ReactNode } from "react";

import type { BlockId } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import type { Box } from "../canvas/viewport";
import type { MovePreview } from "../canvas/viewport-state";
import { useBlock } from "../hooks";
import { BlockView } from "./BlockView";
import { FrameBlock } from "./FrameBlock";
import { ShapeSvg } from "./ShapeSvg";
import { TextBlock } from "./TextBlock";
import { useBlockContext } from "./block-context";
import { canvasItemStyle, endpointOf, isCanvasSubType } from "./canvas-geometry";

/**
 * A canvas element: the positioned wrapper (the geometry -> the style)
 * around the element's renderer. The canvas-only types render their
 * built-in canvas renderers HERE (not through BlockView — they render
 * ONLY inside a surface; a stray one at the page root falls to the
 * placeholder). A consumer renderer for a canvas-only type wins over the
 * built-in. The selection indicator (`data-selected`): the canvas view's
 * marquee/click selection (the shared `blocks` selection) tints the item.
 * No gutter (the canvas rows have no reading order to drag). The
 * canvas-text's font attrs are data (not theme): inline styles on the
 * wrapper.
 */
function CanvasItem({
  id,
  pendingConnector = null,
  movePreview = null,
  resizeBox = null,
  rotatePreview = null,
}: {
  id: BlockId;
  pendingConnector?: string | null;
  /** The in-flight move preview (canvas px); the wrapper stands offset. */
  movePreview?: MovePreview | null;
  /** The in-flight resize preview (the canvas box); the wrapper adopts it. */
  resizeBox?: Box | null;
  /** The in-flight rotate preview (degrees); the wrapper rotates to it. */
  rotatePreview?: number | null;
}) {
  const { store, renderers } = useEditorContext();
  const { siblings } = useBlockContext();
  const block = useBlock(id);
  const blocks = useStore(store, (state) => state.blocks);
  const selected = useStore(store, (state) => state.selection.kind === "blocks" && state.selection.ids.includes(id));
  const connectorPending = pendingConnector === id;
  if (block === undefined) return null;
  let content: ReactNode;
  if (isCanvasSubType(block.type)) {
    const custom = renderers[block.type];
    content =
      custom !== undefined ? (
        custom({ id, block })
      ) : block.type === "shape" ? (
        <ShapeSvg id={id} block={block} />
      ) : block.type === "canvas-text" ? (
        <TextBlock id={id} block={block} tag="div" />
      ) : block.type === "frame" ? (
        <FrameBlock id={id} />
      ) : null; // connector: the line lives in the overlay layer
  } else {
    content = <BlockView id={id} />;
  }

  const style = canvasItemStyle(block);
  // The connector's body is the overlay layer's line (pointer-events:
  // none): the wrapper is an empty box standing at the origin — it must
  // not catch pointers (the press falls through to the item below / the
  // empty canvas) and carries no geometry to move.
  if (block.type === "connector") style.pointerEvents = "none";
  // The move preview stands the wrapper offset from its committed
  // position (the release commit writes the geometry; the preview is
  // pure view state); the resize box / the rotate preview stand the same
  // way (the rotation preview stands over the stored one).
  if (movePreview !== null || resizeBox !== null || rotatePreview !== null) {
    if (resizeBox !== null) {
      style.left = `calc(50% + ${resizeBox.x}px)`;
      style.top = `calc(50% + ${resizeBox.y}px)`;
      style.width = `${resizeBox.w}px`;
      style.height = `${resizeBox.h}px`;
    }
    const parts = ["translate(-50%, -50%)"];
    // The move offset stands BEFORE the rotation (the Δ is in the canvas
    // axes; a trailing translate would land in the rotated frame).
    if (movePreview !== null) parts.push(`translate(${movePreview.dx}px, ${movePreview.dy}px)`);
    const rotation = rotatePreview !== null ? rotatePreview : (block.geometry?.rotation ?? 0);
    if (rotation !== 0) parts.push(`rotate(${rotation}deg)`);
    style.transform = parts.join(" ");
  }
  if (block.type === "canvas-text") {
    const { fontSize, fontFamily, textAlign } = block.attrs ?? {};
    if (fontSize !== undefined) style.fontSize = fontSize;
    if (fontFamily !== undefined) style.fontFamily = fontFamily;
    if (textAlign !== undefined) {
      // The attr is an open CSS value (the schema keeps it a string); the
      // style type is the closed TextAlign union.
      style.textAlign = textAlign as CSSProperties["textAlign"];
    }
  }

  // The connector's lenient posture: an endpoint that does not resolve
  // within the surface (a docId ref, an absent block, or attrs missing in
  // raw data) is marked here — the overlay skips the line.
  const missing =
    block.type === "connector" &&
    (block.attrs === undefined ||
      endpointOf(block.attrs.start, siblings, blocks) === null ||
      endpointOf(block.attrs.end, siblings, blocks) === null);

  return (
    <div
      data-slot="docblocks/canvas-item"
      data-block-id={id}
      data-selected={selected || undefined}
      data-connector-pending={connectorPending || undefined}
      data-missing={missing || undefined}
      className={selected || connectorPending ? "bg-(--docblocks-selected-background)" : undefined}
      style={style}
    >
      {content}
    </div>
  );
}

export { CanvasItem };
