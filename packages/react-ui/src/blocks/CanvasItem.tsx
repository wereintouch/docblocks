import { useStore } from "zustand";

import { memo } from "react";
import type { CSSProperties, ReactNode } from "react";

import type { BlockId } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import type { Box } from "../canvas/viewport";
import type { MovePreview } from "../canvas/viewport-state";
import { useBlock } from "../hooks";
import { BlockView } from "./BlockView";
import { FrameBlock } from "./FrameBlock";
import { GroupBlock } from "./GroupBlock";
import { ShapeSvg } from "./ShapeSvg";
import { ShapeText } from "./ShapeText";
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
 * wrapper. The connector's pending endpoint stands no tint of its own
 * (the dashed preview line is the pick's indicator; the shape itself
 * stands clean) — the wrapper only carries the data-connector-pending
 * hook.
 */
const CanvasItem = memo(
  function CanvasItem({
    id,
    pendingConnector = null,
    movePreview = null,
    resizeBox = null,
  }: {
    id: BlockId;
    pendingConnector?: string | null;
    /** The in-flight move preview (canvas px); the wrapper stands offset. */
    movePreview?: MovePreview | null;
    /** The in-flight resize preview (the canvas box); the wrapper adopts it. */
    resizeBox?: Box | null;
  }) {
    const { store, renderers } = useEditorContext();
    const { siblings } = useBlockContext();
    const block = useBlock(id);
    const selected = useStore(store, (state) => state.selection.kind === "blocks" && state.selection.ids.includes(id));
    // The connector's lenient posture: an endpoint that does not resolve
    // within the surface (a docId ref, an absent block, or attrs missing
    // in raw data) is marked here — the overlay skips the line. The read
    // stands a point boolean (the narrow read): a non-connector stands
    // the stable false (a blocks-map change re-renders no item), a
    // connector re-renders only when its resolution flips.
    const isConnector = block !== undefined && block.type === "connector";
    const connectorAttrs = isConnector ? block.attrs : undefined;
    const missing = useStore(
      store,
      (state) =>
        isConnector &&
        (connectorAttrs === undefined ||
          endpointOf(connectorAttrs.start, siblings, state.blocks) === null ||
          endpointOf(connectorAttrs.end, siblings, state.blocks) === null)
    );
    const connectorPending = pendingConnector === id;
    if (block === undefined) return null;
    // The shape's effective box (the resize preview's live box; the committed
    // geometry otherwise): the figure + the text overlay redraw
    // box-proportional in real time (the preview stands the commit's numbers).
    const shapeBox = resizeBox !== null ? { w: resizeBox.w, h: resizeBox.h } : undefined;
    let content: ReactNode;
    if (isCanvasSubType(block.type)) {
      const custom = renderers[block.type];
      content =
        custom !== undefined ? (
          custom({ id, block })
        ) : block.type === "shape" ? (
          <>
            <ShapeSvg id={id} block={block} box={shapeBox} />
            <ShapeText id={id} block={block} box={shapeBox} />
          </>
        ) : block.type === "canvas-text" ? (
          <TextBlock id={id} block={block} tag="div" />
        ) : block.type === "frame" ? (
          <FrameBlock id={id} />
        ) : block.type === "group" ? (
          <GroupBlock id={id} block={block} selected={selected} />
        ) : null; // connector: the line lives in the overlay layer
    } else {
      content = <BlockView id={id} />;
    }

    const style = canvasItemStyle(block);
    // The connector's body is the overlay layer's line (pointer-events:
    // none): the wrapper is an empty box standing at the origin — it must
    // not catch pointers (the press falls through to the item below / the
    // empty canvas) and carries no geometry to move.
    if (block.type === "connector" || block.type === "group") style.pointerEvents = "none";
    // The move preview stands the wrapper offset from its committed
    // position (the release commit writes the geometry; the preview is
    // pure view state); the resize box stands the same way (the live box
    // replaces the committed one).
    if (movePreview !== null || resizeBox !== null) {
      if (resizeBox !== null) {
        style.left = `calc(50% + ${resizeBox.x}px)`;
        style.top = `calc(50% + ${resizeBox.y}px)`;
        style.width = `${resizeBox.w}px`;
        style.height = `${resizeBox.h}px`;
      }
      const parts = ["translate(-50%, -50%)"];
      if (movePreview !== null) parts.push(`translate(${movePreview.dx}px, ${movePreview.dy}px)`);
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

    return (
      <div
        data-slot="docblocks/canvas-item"
        data-block-id={id}
        data-selected={selected || undefined}
        data-connector-pending={connectorPending || undefined}
        data-missing={missing || undefined}
        // The connector stands no wrapper tint or outline: its emphasis is
        // the line's selected stroke (the 100x100 default box at the origin
        // would stand a phantom square over the page miniature). The
        // selected item's thin cyan outline (the shared selection token) stands
        // over the tint.
        className={
          selected && block.type !== "connector" && block.type !== "group"
            ? `
              bg-(--docblocks-selected-background) outline-(length:--docblocks-canvas-selection-border-width)
              outline-offset-1 outline-(--docblocks-canvas-selection-border-color) outline-solid
            `
            : undefined
        }
        style={style}
      >
        {content}
      </div>
    );
  },
  // The wide blocks read stands the point boolean subscription, so the
  // props are the whole render input: a resting item (the null previews,
  // the stable ids) bails on the move / resize session's pointermoves.
  (prev, next) =>
    prev.id === next.id &&
    prev.pendingConnector === next.pendingConnector &&
    prev.movePreview === next.movePreview &&
    prev.resizeBox === next.resizeBox
);

export { CanvasItem };
