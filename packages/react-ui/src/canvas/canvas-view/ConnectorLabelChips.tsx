/** The connector label chips (the display stand) for a surface's children:
 * every labeled connector's midpoint — the shared chip, the opaque theme
 * background over the line's own frame. The caller's `selectedIds` stand
 * the selected emphasis (the frame's selected token); `skipId` (the edit's
 * connector) stands off (its edit chip stands it). Rendered in the
 * surface's world container (the canvas-world / the page view's canvas
 * div) so the chips stand over the lines (the world's space).
 *
 * The re-render contract (the big-canvas performance stand): the
 * previews are NOT a prop — the chips subscribe to the viewport's store's
 * preview stand themselves (the stable EMPTY stand while no session
 * stands — no re-render, the frame; the live previews over the in-flight
 * gesture). The per-label midpoint's cache keys on the preview's touch
 * signature (the label's endpoints over the previewed set + the preview's
 * values): a drag re-computes the midpoints of the TOUCHED labels only —
 * the resting labels stand their cached midpoint (no per-frame re-route
 * over the whole surface). */
import { useStore } from "zustand";

import { useRef } from "react";
import { useMemo } from "react";
import type { ReactNode } from "react";

import type { BlockId } from "docblocks-core";

import { useEditorContext } from "../../editor-provider";
import { useDarkTheme } from "../../shared/dark-theme";
import { connectorStrokeWidthOf, effectiveConnectorStrokeOf } from "../connector-utils";
import { connectorMidpoint } from "../geometry";
import { type CanvasSession, useChipsPreviews } from "../viewport";
import { ConnectorLabelChip } from "./ConnectorLabelChip";

const EMPTY_SELECTED: BlockId[] = [];

/** The labeled connector's render stand (the chrome-stamp keyed — the
 * preview's stand is out of it: the label / the stroke / the endpoint's
 * refs stand the committed data). */
interface LabelStand {
  id: BlockId;
  label: string;
  stroke: string;
  width: number;
  lineStyle: "solid" | "dash" | "dot";
  startBlockId: string | null;
  endBlockId: string | null;
}

/** The per-label midpoint's cache key (the preview's touch stand): the
 * committed-geometry's stand over the untouched label, the preview's
 * values' stand over the touched one (a touched label re-computes its
 * midpoint per frame, the untouched one stands the cache). */
function midpointSignature(stand: LabelStand, previews: CanvasSession): string {
  const { movePreview, resizePreview, endpointDrag, endpointPreview } = previews;
  if (movePreview === null && resizePreview === null && endpointDrag === null) return "i";
  const parts: string[] = [];
  if (
    movePreview !== null &&
    ((stand.startBlockId !== null && movePreview.idSet.has(stand.startBlockId)) ||
      (stand.endBlockId !== null && movePreview.idSet.has(stand.endBlockId)))
  ) {
    parts.push(`m${movePreview.dx}x${movePreview.dy}`);
  }
  if (resizePreview !== null && (resizePreview.id === stand.startBlockId || resizePreview.id === stand.endBlockId)) {
    parts.push(`r${resizePreview.box.x},${resizePreview.box.y},${resizePreview.box.w},${resizePreview.box.h}`);
  }
  if (endpointDrag !== null && endpointDrag.connectorId === stand.id) {
    const point = endpointPreview?.point ?? null;
    const snap = endpointPreview?.snap ?? null;
    parts.push(`e${point !== null ? `${point.x},${point.y}` : "-"},${snap !== null ? snap.blockId : "-"}`);
  }
  return parts.length === 0 ? "i" : parts.join(";");
}

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
  // The chips' stands stand over the siblings' geometry, the labels / the
  // strokes over the connectors' own attrs: the chrome stamp keys the
  // stand memo (an O(1) read — the whole-map subscription would stand a
  // re-render over every keystroke in the doc); a stable stamp stands the
  // memo.
  const chromeStamp = useStore(store, (state) => state.chromeStamp);
  // The document's dark theme's stand (the data color's render-time's
  // transform — the flip's re-render of the chips' frames).
  const isDark = useDarkTheme();
  const previews = useChipsPreviews();
  const stands = useMemo<LabelStand[]>(() => {
    const blocks = store.getState().blocks;
    const result: LabelStand[] = [];
    for (const cid of children) {
      const block = blocks[cid];
      if (block === undefined || block.type !== "connector" || block.attrs === undefined) continue;
      const label = block.attrs.label ?? "";
      if (label === "" || cid === skipId) continue;
      const selected = selectedIds.includes(cid);
      const stroke = effectiveConnectorStrokeOf(block, selected, isDark);
      result.push({
        id: cid,
        label,
        stroke,
        width: connectorStrokeWidthOf(block.attrs, selected),
        lineStyle: block.attrs.strokeStyle ?? "solid",
        startBlockId: typeof block.attrs.start.blockId === "string" ? block.attrs.start.blockId : null,
        endBlockId: typeof block.attrs.end.blockId === "string" ? block.attrs.end.blockId : null,
      });
    }
    return result;
  }, [chromeStamp, children, isDark, selectedIds, skipId, store]);
  // The per-label midpoint's cache (the component's ref): the touch
  // signature's stand (the label's endpoints over the previewed set + the
  // preview's values) — the untouched label's midpoint stands over the
  // committed geometry (the EMPTY previews), the touched one re-computes
  // (the line's live re-draw's input).
  const midCacheRef = useRef(new Map<string, { sig: string; mid: { x: number; y: number } | null }>());
  const midCache = midCacheRef.current;
  const blocks = store.getState().blocks;
  const chips: ReactNode[] = [];
  for (const stand of stands) {
    const sig = midpointSignature(stand, previews);
    const cacheKey = `${stand.id}|${chromeStamp}`;
    const cached = midCache.get(cacheKey);
    let mid: { x: number; y: number } | null;
    if (cached !== undefined && cached.sig === sig) {
      mid = cached.mid;
    } else {
      mid = connectorMidpoint(stand.id, children, blocks, previews);
      midCache.set(cacheKey, { sig, mid });
    }
    if (mid === null) continue;
    chips.push(
      <ConnectorLabelChip
        key={stand.id}
        id={stand.id}
        mid={mid}
        stroke={stand.stroke}
        width={stand.width}
        lineStyle={stand.lineStyle}
        label={stand.label}
      />
    );
  }
  return <>{chips}</>;
}

export { ConnectorLabelChips };
