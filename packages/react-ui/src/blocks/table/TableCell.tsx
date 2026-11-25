/** The table's cell renderer (the row / column drag's transform — the cell
 * is the transform's element: the `<tr>` is not a CSS transformable
 * element, so the row's drag applies over the row's cells; the dragged
 * cell's card background; the column/row's background is kept) + the cell's
 * own-content layer. */
import { memo, useEffect, useRef } from "react";
import type { CSSProperties } from "react";

import { BLOCK_REGISTRY } from "docblocks-core";
import type { Block, BlockId } from "docblocks-core";

import { focusCaretIn, focusCellActivation } from "../../editing/block-commands";
import { useEditorContext } from "../../editor-provider";
import { useBlock } from "../../hooks";
import { BlockContext, useBlockContext, useBlockContextValue } from "../../shared/providers/block-context";
import { cn } from "../../shared/ui/cn";
import { useTextInner } from "../../text/text-inner";
import { BlockGroups } from "../BlockView";
import { CellActivation } from "./CellActivation";
import { DRAG_TRANSITION, EMPTY_IDS } from "./constants";
import { useTableCellRangeHandlers } from "./table-range-context";
import {
  RANGE_EDGE_BOTTOM,
  RANGE_EDGE_LEFT,
  RANGE_EDGE_RIGHT,
  RANGE_EDGE_TOP,
  RANGE_SELECTED,
  useTableCellRangeMask,
} from "./use-table-cell-range";

/** One cell: its flat content sequence renders through the flat sequence renderer. */
const TableCell = memo(function TableCell({
  id,
  dragX,
  dragShifted,
  rowDy,
  rowShifted,
}: {
  id: BlockId;
  dragX: number;
  dragShifted: boolean;
  /** The row drag's dy (the row's transform over the cell). */
  rowDy: number;
  rowShifted: boolean;
}) {
  const cell = useBlock(id);
  // The read-only stand (view / published): the cell's activation layer's
  // stand is off (the cell is not editable there).
  const { viewMode } = useEditorContext();
  // The cell range's stand: the cell's corner grip (the rectangle's drag) and
  // the cell's highlight inside the range.
  const rangeHandlers = useTableCellRangeHandlers();
  const rangeMask = useTableCellRangeMask(id);
  const selected = (rangeMask & RANGE_SELECTED) !== 0;
  const children = cell !== undefined && cell.type === "table-cell" ? (cell.children ?? EMPTY_IDS) : EMPTY_IDS;
  const contextValue = useBlockContextValue(id, children, "table-cell");
  if (cell === undefined || cell.type !== "table-cell") return null;
  // The cell background: the column color over the row color (the column
  // wins; removing it reveals the row's color).
  const background = cell.attrs?.columnColor ?? cell.attrs?.rowColor;
  const hasDrag = dragX !== 0 || rowDy !== 0;
  // The dragged row / column's cell (the pointer's live follow; the
  // stationary cells take the parting shift): the card takes a background
  // over the uncolored cells — the empty cell's borders alone do not read
  // as the moving card.
  const dragged = hasDrag && !dragShifted && !rowShifted;
  const style: CSSProperties = {
    ...(background !== undefined ? { background } : {}),
    ...(selected && !dragged ? { background: "var(--docblocks-table-range-background)" } : {}),
    ...(dragged && background === undefined
      ? { background: "var(--docblocks-table-drag-background, transparent)" }
      : {}),
    ...(dragged
      ? {
          // The dragged card's boundary: the collapsed cell's borders stand
          // on the table's layout and do not travel over the transform —
          // the card keeps a thin inset outline (the cell's line stand)
          // in the same shadow as the drag's elevation.
          boxShadow:
            "var(--docblocks-table-drag-shadow, none), inset 0 0 0 var(--docblocks-table-border-width) var(--docblocks-table-border-color)",
        }
      : {}),
    ...(hasDrag
      ? {
          transform: `translate(${dragX}px, ${rowDy}px)`,
          position: "relative" as const,
          zIndex: dragged ? 10 : undefined,
          transition: dragged ? undefined : DRAG_TRANSITION,
        }
      : {}),
  };
  // The range's frame: the rectangle's boundary stands the selection border
  // over the cells the edges touch (the other edges stay the cell's own
  // border) — one inset shadow per boundary side, merged with the drag's.
  const frameEdges = [
    ...((rangeMask & RANGE_EDGE_TOP) !== 0
      ? [`inset 0 var(--docblocks-table-range-border-width) 0 0 var(--docblocks-table-range-border-color)`]
      : []),
    ...((rangeMask & RANGE_EDGE_BOTTOM) !== 0
      ? [`inset 0 calc(-1 * var(--docblocks-table-range-border-width)) 0 0 var(--docblocks-table-range-border-color)`]
      : []),
    ...((rangeMask & RANGE_EDGE_LEFT) !== 0
      ? [`inset var(--docblocks-table-range-border-width) 0 0 0 var(--docblocks-table-range-border-color)`]
      : []),
    ...((rangeMask & RANGE_EDGE_RIGHT) !== 0
      ? [`inset calc(-1 * var(--docblocks-table-range-border-width)) 0 0 0 var(--docblocks-table-range-border-color)`]
      : []),
  ];
  if (frameEdges.length > 0) {
    style.boxShadow = [style.boxShadow, ...frameEdges].filter((part) => part !== undefined && part !== "").join(", ");
  }

  // The cell's own content (the text-cell shape: the runs stand in
  // addition to the children blocks) renders as an editable layer above
  // the children; a wholly empty cell takes the activation layer.
  const hasOwnText = (cell.content ?? []).some((run) => run.text !== "");
  // The merged region's spans: the anchor cell stands the region's rectangle
  // over the grid columns and rows (the covered cells are absent from their
  // rows — the browser's own table layout carries the geometry).
  const colspan = cell.attrs?.colspan;
  const rowspan = cell.attrs?.rowspan;
  return (
    <td
      data-slot="docblocks/table-cell"
      data-block-id={id}
      colSpan={colspan !== undefined && colspan > 1 ? colspan : undefined}
      rowSpan={rowspan !== undefined && rowspan > 1 ? rowspan : undefined}
      data-range={selected ? "true" : undefined}
      className="
        group/cell relative border-(length:--docblocks-table-border-width) border-(--docblocks-table-border-color)
        p-(--docblocks-table-cell-padding) align-top
      "
      style={style}
    >
      <BlockContext.Provider value={contextValue}>
        {hasOwnText ? <CellContent id={id} block={cell} /> : null}
        {/* The cell's activation layer (the empty cell's caret's seat):
            the read-only stand (view / published) stands no layer (the
            cell is not editable there) — the empty's placeholder keeps
            the edit's minimum row height (the activation layer's
            footprint: one line's height). */}
        {children.length === 0 && !hasOwnText ? (
          viewMode ? (
            <span
              aria-hidden
              data-slot="docblocks/cell-empty"
              className="my-(--docblocks-block-spacing) block whitespace-pre-wrap"
            >
              {"\u200b"}
            </span>
          ) : (
            <CellActivation cellId={id} />
          )
        ) : (
          <BlockGroups ids={children} />
        )}
        {/* The range's corner grip (the cell rectangle's drag): the editing
            stand only — the read-only modes keep the grid inert. */}
        {rangeHandlers !== null && !viewMode ? (
          <span
            aria-hidden
            data-slot="docblocks/table-cell-range-grip"
            className="
              absolute top-1 right-1 size-2 cursor-crosshair rounded-full bg-(--docblocks-table-border-color) opacity-0
              transition-opacity
              group-hover/cell:opacity-100
            "
            onPointerDown={rangeHandlers.onGripPointerDown(id)}
            onPointerMove={rangeHandlers.onGripPointerMove}
            onPointerUp={rangeHandlers.onGripPointerUp}
            onPointerCancel={rangeHandlers.onGripPointerUp}
          />
        ) : null}
      </BlockContext.Provider>
    </td>
  );
});
/**
 * The cell's own content layer: the cell's runs render as an editable
 * text layer at the top of the cell (the v1 text-cell shape — a cell may
 * carry its own text in addition to its children blocks). The cell
 * gestures own the keys: Enter is a soft line break at every position,
 * Backspace at the line start is a no-op, and the paste is plain text
 * only (the inCell model, the same as the cell's paragraphs).
 */
function CellContent({ id, block }: { id: BlockId; block: Extract<Block, { type: "table-cell" }> }) {
  const context = useBlockContext();
  const { doc, viewMode } = useEditorContext();
  const { innerRef, onInput, onPaste, onKeydown } = useTextInner({
    id,
    block,
    blockType: "table-cell",
    context,
  });
  const align = block.attrs?.align;
  /** True while the browser focus stands in the layer (the unmount park). */
  const focusInRef = useRef(false);
  /** The editor root the seat scopes to (captured at focus time). */
  const scopeRef = useRef<ParentNode>(document);

  // The layer unmounts with the last character deleted (the cell normalizes
  // to content: []): the browser drops the focus to the document — park it
  // (the undo hotkey reach) where the caret can stand: the first text child
  // (the reading order continues in the children) or the activation layer
  // in a childless cell. A focus that left the layer (the user moved on)
  // must not be stolen.
  useEffect(
    () => () => {
      if (!focusInRef.current) return;
      const cell = doc.getBlock(id);
      if (cell === null || cell.type !== "table-cell") return;
      const child = (cell.children ?? []).find((childId) => {
        const b = doc.getBlock(childId);
        return b !== null && BLOCK_REGISTRY[b.type].content;
      });
      if (child !== undefined) focusCaretIn(child, 0, scopeRef.current);
      else focusCellActivation(id, scopeRef.current);
    },
    [doc, id]
  );
  const onLayerFocus = () => {
    focusInRef.current = true;
    scopeRef.current = innerRef.current?.closest<HTMLElement>("[data-slot='docblocks/editor']") ?? document;
  };
  const onLayerBlur = () => {
    focusInRef.current = false;
  };

  return (
    <div
      ref={innerRef}
      // The read-only stand (view / published): the layer stands
      // contenteditable=false (the cell's editing's path is off).
      contentEditable={!viewMode}
      suppressContentEditableWarning
      spellCheck={false}
      data-slot="docblocks/block-content"
      data-block-id={id}
      className={cn(
        "my-(--docblocks-block-spacing) wrap-break-word whitespace-pre-wrap outline-none",
        align === "center" && "text-center",
        align === "right" && "text-right"
      )}
      onFocus={onLayerFocus}
      onBlur={onLayerBlur}
      onInput={onInput}
      onPaste={onPaste}
      onKeyDown={onKeydown}
    />
  );
}

export { TableCell };
