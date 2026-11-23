import { useTranslation } from "react-i18next";
import { useStore } from "zustand";

import { memo } from "react";
import type { CSSProperties, ReactNode } from "react";

import type { BlockId } from "docblocks-core";

import { BlockView } from "../blocks/BlockView";
import { TextBlock } from "../blocks/TextBlock";
import { useEditorContext } from "../editor-provider";
import { useBlock } from "../hooks";
import { useBlockContext } from "../shared/providers/block-context";
import { cn } from "../shared/ui/cn";
import { ConnectorLine } from "./ConnectorLine";
import { FrameBlock } from "./FrameBlock";
import { GroupBlock } from "./GroupBlock";
import { ShapeSvg } from "./ShapeSvg";
import { ShapeText } from "./ShapeText";
import { CANVAS_KB_FOCUS_OUTLINE, CANVAS_SELECTION_OUTLINE } from "./canvas-view/constants";
import { canvasItemStyle, endpointOf, isCanvasSubType } from "./geometry";
import { SHAPE_FONT_STACKS, textStyleOf } from "./text-fonts";
import { EMPTY_MOVE_DELTA, useKbFocus, useMovePreviewDelta, useResizePreviewBox } from "./viewport";

/** The canvas item's accessible label's i18n key (the block type's stand
 * — the `canvas` namespace's `item.*`; the consumer's renderer's type
 * stands the type's string over the `item.other`'s interpolation). */
const CANVAS_ITEM_LABEL_KEYS: Record<string, string> = {
  shape: "item.shape",
  "canvas-text": "item.text",
  frame: "item.frame",
  group: "item.group",
  connector: "item.connector",
};

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
 * hook. The connector's line stands INSIDE the wrapper (the Z-ORDER
 * stand, the explicit zIndex — the DOM order is the paint
 * order, the line can stand over or under a figure); `interactive`
 * toggles the line's hit path (the page view's surface stands it inert).
 *
 * The in-flight session's previews are NOT props: the wrapper
 * subscribes to the viewport's store's per-item slices (the move
 * preview's delta over the dragged item only, the resize box over the
 * resized item only, the keyboard focus over the focused item only).
 * A pointermove re-renders the touched items only — the resting items
 * stand their memo (the stable EMPTY stand over the selector's
 * bail-out). */
/** The canvas-text's side inset from the box's edges (the shape's text's
 * padding parity — the rect's 8 px x). The text stands inside the box's
 * edges (the edge's stick's stand is the missing inset's gap). */
const CANVAS_TEXT_PADDING_X = 8;

const CanvasItem = memo(
  function CanvasItem({
    id,
    pendingConnector = null,
    interactive = true,
  }: {
    id: BlockId;
    pendingConnector?: string | null;
    /** The line's interactivity (the hit path / the selection reach): the
     *  canvas view stands it, the page view's surface stands it inert. */
    interactive?: boolean;
  }) {
    const { t } = useTranslation("canvas");
    const { store, renderers } = useEditorContext();
    const { siblings } = useBlockContext();
    const block = useBlock(id);
    const selected = useStore(store, (state) => state.selection.kind === "blocks" && state.selection.ids.includes(id));
    // The per-item session's subscriptions (the narrow slice stand — the
    // inert consumers re-provide the EMPTY viewport store: the stable
    // stand, no re-renders).
    const movePreview = useMovePreviewDelta(id);
    const moveActive = movePreview !== EMPTY_MOVE_DELTA;
    const resizeBox = useResizePreviewBox(id);
    const kbFocused = useKbFocus(id);
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
          <FrameBlock id={id} selected={selected} chipMode={interactive ? "hidden" : "inert"} />
        ) : block.type === "group" ? (
          <GroupBlock id={id} block={block} selected={selected} chipMode={interactive ? "hidden" : "inert"} />
        ) : block.type === "connector" ? (
          <ConnectorLine id={id} interactive={interactive} />
        ) : null;
    } else {
      content = <BlockView id={id} />;
    }

    const style = canvasItemStyle(block);
    const itemLabelKey = CANVAS_ITEM_LABEL_KEYS[block.type];
    // The connector's body is the line (pointer-events: none over the
    // svg root, the hit path re-enables the stroke): the wrapper is a
    // box standing at the origin — it must not catch pointers (the press
    // falls through to the item below / the empty canvas) and carries no
    // geometry to move. The group's / the frame's interior stands
    // pointer-transparent too (the members / the figures under the box
    // stand their own press): the press targets stand in the renderer's
    // pointer-events: auto strips over the none's wrapper (the border's
    // hit band + the title chip).
    if (block.type === "connector" || block.type === "group" || block.type === "frame") style.pointerEvents = "none";
    // The move preview stands the wrapper offset from its committed
    // position (the release commit writes the geometry; the preview is
    // pure view state); the resize box stands the same way (the live box
    // replaces the committed one).
    if (moveActive || resizeBox !== null) {
      if (resizeBox !== null) {
        style.left = `calc(50% + ${resizeBox.x}px)`;
        style.top = `calc(50% + ${resizeBox.y}px)`;
        style.width = `${resizeBox.w}px`;
        style.height = `${resizeBox.h}px`;
      }
      const parts = ["translate(-50%, -50%)"];
      if (moveActive) parts.push(`translate(${movePreview.dx}px, ${movePreview.dy}px)`);
      style.transform = parts.join(" ");
    }
    if (block.type === "canvas-text") {
      // The font attrs are data (not theme): the inline styles stand the
      // shape's text parity — the family's stack (the raw name's fallback
      // — the consumer's own font by name), the color (the absent stand
      // keeps the inherited default), the weight x the slant (the shared
      // textStyle's mapping).
      const attrs = block.attrs;
      if (attrs?.fontSize !== undefined) style.fontSize = attrs.fontSize;
      if (attrs?.fontFamily !== undefined) style.fontFamily = SHAPE_FONT_STACKS[attrs.fontFamily] ?? attrs.fontFamily;
      if (attrs?.textAlign !== undefined) {
        // The attr is an open CSS value (the schema keeps it a string); the
        // style type is the closed TextAlign union.
        style.textAlign = attrs.textAlign as CSSProperties["textAlign"];
      }
      if (attrs?.textColor !== undefined) style.color = attrs.textColor;
      const textStyle = textStyleOf(attrs?.textStyle);
      style.fontWeight = textStyle.fontWeight;
      if (textStyle.fontStyle !== undefined) style.fontStyle = textStyle.fontStyle;
      // The side insets from the box's edges (the shape's text's parity —
      // the rect's 8 px x): the wrapper's border box stands the item's
      // geometry — the selection's frame and the position are unmoved
      // (the preflight's border-box), the text's wrap width stands the
      // inset's width.
      style.padding = `0 ${CANVAS_TEXT_PADDING_X}px`;
    }

    return (
      <div
        data-slot="docblocks/canvas-item"
        data-block-id={id}
        data-selected={selected || undefined}
        data-kb-focused={kbFocused || undefined}
        data-connector-pending={connectorPending || undefined}
        data-missing={missing || undefined}
        // The connector stands no wrapper tint or outline: its emphasis is
        // the line's selected stroke (the 100x100 default box at the origin
        // would stand a phantom square over the page miniature). The
        // selected item's thin cyan outline (the shared selection token) stands
        // over the tint. The keyboard focus's dashed outline stands the
        // same items (the connector / group's box stands no stand of its
        // own, the selection's parity). The item's role stands the image's
        // (the object's stand for the screen reader's): the keyboard's
        // operations stand the container's (the role's application — the
        // items are not individually operable, so the pressed's stand is
        // out of their contract).
        role="img"
        aria-label={itemLabelKey !== undefined ? t(itemLabelKey) : t("item.other", { type: block.type })}
        className={cn(
          selected &&
            block.type !== "connector" &&
            block.type !== "group" &&
            cn("bg-(--docblocks-selected-background)", CANVAS_SELECTION_OUTLINE),
          kbFocused && !selected && block.type !== "connector" && block.type !== "group" && CANVAS_KB_FOCUS_OUTLINE
        )}
        style={style}
      >
        {content}
      </div>
    );
  },
  // The per-item session's subscriptions stand the move / resize / kb
  // stand inside the component, so the props are the whole render input
  // for the PARENT-driven re-renders: a resting item (the stable id,
  // the stand props) bails on the move / resize session's pointermoves
  // (the touched items re-render over their own subscription).
  (prev, next) =>
    prev.id === next.id && prev.pendingConnector === next.pendingConnector && prev.interactive === next.interactive
);

export { CanvasItem, CANVAS_TEXT_PADDING_X };
