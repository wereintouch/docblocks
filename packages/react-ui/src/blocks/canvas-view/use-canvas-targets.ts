/** The canvas view's derived targets: the page/surface split, the page's
 * block context, the single-selection handles (the effective box + the
 * resize preview's stand), the multi-selection's summary box, the shape /
 * connector toolbars' targets, the connector label's edit target, the
 * selected line's endpoint handles, and the pending connector's preview
 * stand points. All stand on the root's children, the block map, the store
 * selection, and the viewport's live session state. */
import { useMemo } from "react";

import type { Block, BlockId, Selection } from "docblocks-core";

import { connectorPreviewFrom, connectorPreviewPoint, zPositionOf } from "../../canvas";
import type { CanvasViewportState } from "../../canvas";
import { useBlockContextValue } from "../block-context";
import { connectorHandlePoints, connectorMidpoint, edgePointOf, effectiveGeometry } from "../canvas-geometry";
import { CONNECTOR_SELECTED_STROKE, CONNECTOR_STROKE } from "../connector-constants";
import { connectorStrokeWidthOf } from "../connector-utils";

interface CanvasTargetsDeps {
  rootChildren: BlockId[];
  blocks: Record<BlockId, Block>;
  storeSelection: Selection;
  viewport: CanvasViewportState;
  rootBlockId: BlockId;
}

function useCanvasTargets({ rootChildren, blocks, storeSelection, viewport, rootBlockId }: CanvasTargetsDeps) {
  const { pageChildren, surfaces } = useMemo(() => {
    const page: BlockId[] = [];
    const list: { id: BlockId; children: BlockId[] }[] = [];
    for (const id of rootChildren) {
      const block = blocks[id];
      if (block === undefined) continue;
      if (block.type === "surface") {
        list.push({ id, children: block.children ?? [] });
      } else {
        page.push(id);
      }
    }
    return { pageChildren: page, surfaces: list };
  }, [rootChildren, blocks]);

  const pageContext = useBlockContextValue(rootBlockId, pageChildren, "root");

  // The handles' target: a single block selection with an effective box
  // (the stored geometry or the synthesized default; the connector is
  // excluded — it carries no own geometry). The container (the reworked
  // group) carries its own box: the eight resize handles stand it.
  const handleTarget = useMemo(() => {
    if (storeSelection?.kind !== "blocks" || storeSelection.ids.length !== 1) return null;
    const id = storeSelection.ids[0]!;
    const block = blocks[id];
    if (block === undefined || block.type === "connector") return null;
    return { id, box: effectiveGeometry(block) };
  }, [storeSelection, blocks]);
  const displayBox =
    handleTarget !== null && viewport.resizePreview !== null && viewport.resizePreview.id === handleTarget.id
      ? viewport.resizePreview.box
      : (handleTarget?.box ?? null);

  // The multi-selection's summary box: the union of the selected items'
  // effective boxes (the connector is excluded — it carries no own
  // geometry). Hidden while a move preview is in flight (the union is
  // stale then, like the single-selection handles).
  const multiSelectionBox = useMemo(() => {
    if (storeSelection?.kind !== "blocks" || storeSelection.ids.length < 2) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let count = 0;
    for (const id of storeSelection.ids) {
      const block = blocks[id];
      if (block === undefined || block.type === "connector") continue;
      // The container (the reworked group) stands its OWN geometry (the
      // free box) — the derived union stands off.
      const box = effectiveGeometry(block);
      minX = Math.min(minX, box.x - box.w / 2);
      minY = Math.min(minY, box.y - box.h / 2);
      maxX = Math.max(maxX, box.x + box.w / 2);
      maxY = Math.max(maxY, box.y + box.h / 2);
      count += 1;
    }
    if (count < 2 || !Number.isFinite(minX)) return null;
    return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
  }, [storeSelection, blocks]);

  // The color toolbar's target: a single `shape` selection (the fill /
  // stroke attrs); absent for the other canvas types, the multi
  // selection, an active tool, or an in-flight session.
  const shapeToolbarTarget = (() => {
    if (handleTarget === null || viewport.activeTool !== null) return null;
    if (viewport.movePreview !== null || viewport.resizePreview !== null) return null;
    const block = blocks[handleTarget.id];
    if (block === undefined || block.type !== "shape") return null;
    // The z-order stand (the explicit zIndex's position over the surface's
    // canvas elements — the arrange menu's disabled edges).
    const surface = surfaces.find((entry) => entry.children.includes(handleTarget.id));
    const zStand = surface !== undefined ? zPositionOf(surface.children, blocks, handleTarget.id) : null;
    return {
      id: handleTarget.id,
      fill: block.attrs?.fill,
      stroke: block.attrs?.stroke,
      strokeWidth: block.attrs?.strokeWidth,
      strokeStyle: block.attrs?.strokeStyle,
      variant: block.attrs?.variant,
      text: block.attrs?.text,
      fontSize: block.attrs?.fontSize,
      fontFamily: block.attrs?.fontFamily,
      textColor: block.attrs?.textColor,
      textStyle: block.attrs?.textStyle,
      textAlign: block.attrs?.textAlign,
      zStand,
    };
  })();

  // The connector type toolbar's target: a single `connector` selection
  // whose endpoints resolve within the surface (the toolbar seats at the
  // line's midpoint; absent for the multi selection, an active tool, or
  // an in-flight session).
  const connectorToolbarTarget = (() => {
    if (viewport.activeTool !== null) return null;
    if (viewport.movePreview !== null || viewport.resizePreview !== null) return null;
    if (storeSelection?.kind !== "blocks" || storeSelection.ids.length !== 1) return null;
    const id = storeSelection.ids[0]!;
    const block = blocks[id];
    if (block === undefined || block.type !== "connector" || block.attrs === undefined) return null;
    const surface = surfaces.find((entry) => entry.children.includes(id));
    if (surface === undefined) return null;
    const childIds = surface.children;
    // The midpoint's live stand (the endpoint drag's re-draw — the same
    // inputs as the line, so the toolbar follows the line mid-drag; the
    // move / resize's stand is the toolbar's absence above).
    const mid = connectorMidpoint(id, childIds, blocks, {
      movePreview: null,
      resizePreview: null,
      endpointDrag: viewport.connectorEndpoint,
      endpointPreview: viewport.connectorEndpointPreview,
    });
    if (mid === null) return null;
    return {
      id,
      variant: block.attrs.variant,
      strokeColor: block.attrs.strokeColor,
      strokeWidth: block.attrs.strokeWidth,
      strokeStyle: block.attrs.strokeStyle,
      arrowHead: block.attrs.arrowHead,
      arrowStart: block.attrs.arrowStart,
      mid,
      childIds,
      zStand: zPositionOf(childIds, blocks, id),
    };
  })();

  // The label's inline edit's target: the
  // double-click's connector whose endpoints resolve (the input seats at
  // the line's midpoint, the frame stands the line's effective stroke).
  const connectorLabelTarget = (() => {
    const id = viewport.connectorLabelEditing;
    if (id === null) return null;
    const block = blocks[id];
    if (block === undefined || block.type !== "connector" || block.attrs === undefined) return null;
    const surface = surfaces.find((entry) => entry.children.includes(id));
    if (surface === undefined) return null;
    const mid = connectorMidpoint(id, surface.children, blocks);
    if (mid === null) return null;
    const selected = storeSelection?.kind === "blocks" && storeSelection.ids.includes(id);
    const stroke = selected
      ? CONNECTOR_SELECTED_STROKE
      : block.attrs.strokeColor === undefined || block.attrs.strokeColor === "none"
        ? CONNECTOR_STROKE
        : block.attrs.strokeColor;
    return {
      id,
      mid,
      stroke,
      width: connectorStrokeWidthOf(block.attrs, selected),
      lineStyle: block.attrs.strokeStyle ?? "solid",
      label: block.attrs.label ?? "",
    };
  })();

  // The selected line's endpoint handles' points (the screen-space
  // overlay's data — the same resolution as the line's render, the live
  // preview / the snap's stand while the endpoint drag is in flight).
  const selectedConnectorHandles =
    connectorToolbarTarget !== null
      ? connectorHandlePoints(connectorToolbarTarget.childIds, blocks, connectorToolbarTarget.id, {
          movePreview: viewport.movePreview,
          resizePreview: viewport.resizePreview,
          endpointDrag: viewport.connectorEndpoint,
          endpointPreview: viewport.connectorEndpointPreview,
        })
      : null;

  // The pending connector's preview stand points (the world space, so
  // they scale with the zoom): the FROM over the pending stand (the
  // port's point over the port stand, the auto anchor over the plain
  // block ref —; the free stand stands its
  // own point), the END over the cursor's snap (the endpoint drag's
  // parity — the stick to the port / the continuous edge within the
  // radius).
  const previewStandBlock = viewport.pendingConnector !== null ? blocks[viewport.pendingConnector] : undefined;
  const previewFrom =
    viewport.connectorPreview === null || (viewport.pendingConnector === null && viewport.pendingFree === null)
      ? null
      : viewport.pendingFree !== null
        ? viewport.pendingFree
        : connectorPreviewFrom(
            previewStandBlock === undefined ? null : effectiveGeometry(previewStandBlock),
            viewport.pendingPort,
            viewport.connectorPreview.point
          );
  const previewSnap = viewport.connectorPreview?.snap ?? null;
  const previewSnapBlock = previewSnap !== null ? blocks[previewSnap.blockId] : undefined;
  const previewEnd =
    viewport.connectorPreview === null
      ? null
      : connectorPreviewPoint(
          viewport.connectorPreview.point,
          previewSnap,
          previewSnapBlock === undefined ? null : effectiveGeometry(previewSnapBlock)
        );

  // The hover snap's stand point (before the stand): the snapped edge's
  // point over the hovered sibling (the circle + the badge's anchor).
  const hoverSnapBlock = viewport.connectorHoverSnap !== null ? blocks[viewport.connectorHoverSnap.blockId] : undefined;
  const hoverSnapPoint =
    viewport.connectorHoverSnap === null || hoverSnapBlock === undefined
      ? null
      : edgePointOf(effectiveGeometry(hoverSnapBlock), viewport.connectorHoverSnap.port, viewport.connectorHoverSnap.t);

  return {
    pageChildren,
    surfaces,
    pageContext,
    handleTarget,
    displayBox,
    multiSelectionBox,
    shapeToolbarTarget,
    connectorToolbarTarget,
    connectorLabelTarget,
    selectedConnectorHandles,
    previewFrom,
    previewSnap,
    previewEnd,
    hoverSnapPoint,
  };
}

export { useCanvasTargets };
