/** The connector label chips (the display stand) for a surface's children:
 * every labeled connector's midpoint — the shared chip, the opaque theme
 * background over the line's own frame. The caller's `selectedIds` stand
 * the selected emphasis (the frame's selected token); `skipId` (the edit's
 * connector) stands off (its edit chip stands it). Rendered in the
 * surface's world container (the canvas-world / the page view's canvas
 * div) so the chips stand over the lines (the world's space). */
import { useStore } from "zustand";

import { useMemo } from "react";
import type { ReactNode } from "react";

import type { BlockId } from "docblocks-core";

import { useEditorContext } from "../../editor-provider";
import { CONNECTOR_SELECTED_STROKE, CONNECTOR_STROKE } from "../connector-constants";
import { connectorStrokeWidthOf } from "../connector-utils";
import type { ConnectorPreviews } from "../geometry";
import { connectorMidpoint, surfaceChromeKey } from "../geometry";
import { ConnectorLabelChip } from "./ConnectorLabelChip";

const EMPTY_SELECTED: BlockId[] = [];

function ConnectorLabelChips({
  children,
  selectedIds = EMPTY_SELECTED,
  skipId = null,
  previews = undefined,
}: {
  /** The surface's children (the connector's siblings — the midpoint's read). */
  children: readonly BlockId[];
  /** The selected ids (the frame's selected-token emphasis). */
  selectedIds?: readonly BlockId[];
  /** The editing connector (the display chip stands off). */
  skipId?: BlockId | null;
  /** The in-flight canvas previews (the midpoints stand the live geometry
   *  — the chips follow the lines mid-drag, the same inputs as the
   *  lines' re-draw). Absent (the page view's inert surface) stands the
   *  committed geometry. */
  previews?: ConnectorPreviews;
}) {
  const { store } = useEditorContext();
  // The chips' midpoints stand over the siblings' geometry, the labels / the
  // strokes over the connectors' own attrs: the chrome digest keys the chips
  // memo (the whole-map subscription would stand a re-render over every
  // keystroke in the doc); a stable digest stands the memo.
  const chromeKey = useStore(store, (state) => surfaceChromeKey(state.blocks, children));
  const chips: ReactNode[] = useMemo(() => {
    const blocks = store.getState().blocks;
    return children.flatMap((cid) => {
      const block = blocks[cid];
      if (block === undefined || block.type !== "connector" || block.attrs === undefined) return [];
      const label = block.attrs.label ?? "";
      if (label === "" || cid === skipId) return [];
      const mid = connectorMidpoint(cid, children, blocks, previews);
      if (mid === null) return [];
      const selected = selectedIds.includes(cid);
      const stroke = selected
        ? CONNECTOR_SELECTED_STROKE
        : block.attrs.strokeColor === undefined || block.attrs.strokeColor === "none"
          ? CONNECTOR_STROKE
          : block.attrs.strokeColor;
      return [
        <ConnectorLabelChip
          key={cid}
          id={cid}
          mid={mid}
          stroke={stroke}
          width={connectorStrokeWidthOf(block.attrs, selected)}
          lineStyle={block.attrs.strokeStyle ?? "solid"}
          label={label}
        />,
      ];
    });
  }, [chromeKey, children, previews, selectedIds, skipId, store]);
  return <>{chips}</>;
}

export { ConnectorLabelChips };
