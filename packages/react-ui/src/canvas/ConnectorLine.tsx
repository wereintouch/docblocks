/** The canvas connector's per-line component: the line's SVG over the
 * surface's coordinate space (the Z-ORDER stand — the line stands at the
 * connector's position in the surface's children, a connector can stand
 * over or under a figure, not only over every figure), the per-line
 * session's narrow subscription (the viewport's store — the stable EMPTY
 * stand over the untouched lines), the endpoint drag's preview (the
 * content's live re-draw), and the hit path's box (the webkit's
 * hit-test's stand). The line's content math stands in ./connector-line.
 *
 * The SVG is the surface's center-anchor space (the 1x1 overflow-visible
 * at the wrapper's center — the CanvasItem's wrapper stands at the
 * surface's origin), the shared arrowhead defs (the surface's hidden
 * defs svg) stand the markers.
 *
 * The SVG is pointer-events none: the visible path is draw-only. The
 * per-line hit path (the wide transparent stroke, pointer-events stroke)
 * renders in its own bbox-sized svg — the webkit hit-tests only inside
 * the svg's own box, so the 1x1 overflow-visible layer is not
 * click-selectable there; the chromium and the firefox reach the
 * overflow, so the box change alters no behavior there.
 */
import { useStore } from "zustand";

import { useMemo } from "react";

import type { BlockId } from "docblocks-core";

import { useEditorContext } from "../editor-provider";
import { useBlock } from "../hooks";
import { useDarkTheme } from "../shared/dark-theme";
import { useBlockContext } from "../shared/providers/block-context";
import { HIT_BOX_PAD_PX, HIT_STROKE_WIDTH } from "./connector-constants";
import { connectorLineOf, hitBoxOf } from "./connector-line";
import { useLineSession } from "./viewport";

function ConnectorLine({ id, interactive = true }: { id: BlockId; interactive?: boolean }) {
  const { store } = useEditorContext();
  const block = useBlock(id);
  const selected = useStore(store, (state) => state.selection.kind === "blocks" && state.selection.ids.includes(id));
  const context = useBlockContext();
  // The per-line session (the viewport's store's narrow subscription):
  // the stable EMPTY stand while the in-flight previews touch NEITHER of
  // the line's endpoint blocks (the content memo holds — no re-route,
  // no re-render, the frame), the live session (a fresh object per
  // frame) over the touched lines (the endpoints' resolution follows the
  // preview mid-drag). The block's endpoint refs (the block ref's id,
  // null over the free points) stand the touch's read.
  const startBlockId =
    block !== undefined && block.type === "connector" && typeof block.attrs.start.blockId === "string"
      ? block.attrs.start.blockId
      : null;
  const endBlockId =
    block !== undefined && block.type === "connector" && typeof block.attrs.end.blockId === "string"
      ? block.attrs.end.blockId
      : null;
  const session = useLineSession(id, startBlockId, endBlockId);
  // The line's route stands over the siblings' geometry (the obstacles, the
  // endpoints' boxes): the chrome stamp keys the content memo on that data
  // (an O(1) read — the per-surface JSON digest stood the O(siblings) stand
  // per line per store notification); a stable stamp stands the memo (the
  // geometry stands, the content element stays — no svg reconciliation).
  const chromeStamp = useStore(store, (state) => state.chromeStamp);
  // The document's dark theme's stand (the line's data color's
  // render-time's transform — the flip's re-render).
  const isDark = useDarkTheme();
  const content = useMemo(
    () =>
      block === undefined || block.type !== "connector"
        ? null
        : connectorLineOf(
            context.parentId,
            id,
            block,
            context.siblings,
            store.getState().blocks,
            selected,
            interactive,
            session,
            isDark
          ),
    [block, chromeStamp, context.parentId, context.siblings, id, interactive, isDark, selected, session, store]
  );
  if (content === null) return null;
  // The hit path's svg's box (the path's bbox over the pad — the hit
  // stroke's half width + the arrowhead's overshoot; the box's empty
  // area is pointer-events none, the stroke's band stands the click).
  const hitBox = content.hitD !== null ? hitBoxOf(content.hitD) : null;
  return (
    <>
      <svg
        data-slot="docblocks/connector-layer"
        data-block-id={id}
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: 1,
          height: 1,
          overflow: "visible",
          pointerEvents: "none",
        }}
      >
        {content.content}
      </svg>
      {content.hitD !== null && hitBox !== null && (
        <svg
          data-slot="docblocks/connector-hit-layer"
          data-block-id={id}
          style={{
            position: "absolute",
            left: `calc(50% + ${hitBox.x - HIT_BOX_PAD_PX}px)`,
            top: `calc(50% + ${hitBox.y - HIT_BOX_PAD_PX}px)`,
            width: hitBox.w + 2 * HIT_BOX_PAD_PX,
            height: hitBox.h + 2 * HIT_BOX_PAD_PX,
            overflow: "visible",
            pointerEvents: "none",
          }}
        >
          <g transform={`translate(${HIT_BOX_PAD_PX - hitBox.x}, ${HIT_BOX_PAD_PX - hitBox.y})`}>
            {/* The hit path: the wide invisible stroke the line clicks on
                (the click's read stands the `data-connector-hit`'s
                attribute over the event's target — the box's seat is the
                webkit's hit-test's stand, not a behavior's change). */}
            <path
              data-connector-hit={id}
              d={content.hitD}
              stroke="transparent"
              strokeWidth={HIT_STROKE_WIDTH}
              fill="none"
              pointerEvents="stroke"
              className="cursor-pointer"
            />
          </g>
        </svg>
      )}
    </>
  );
}

export { ConnectorLine };
