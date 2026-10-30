/** The table's cell renderer (the drag transform, the column/row
 * background stands) + the cell's own-content layer. */
import { memo, useEffect, useRef } from "react";
import type { CSSProperties } from "react";

import { BLOCK_REGISTRY } from "docblocks-core";
import type { Block, BlockId } from "docblocks-core";

import { focusCaretIn, focusCellActivation } from "../../editing/block-commands";
import { useEditorContext } from "../../editor-provider";
import { useBlock } from "../../hooks";
import { cn } from "../../shared/ui/cn";
import { BlockGroups } from "../BlockView";
import { BlockContext, useBlockContext, useBlockContextValue } from "../block-context";
import { useTextInner } from "../text-inner";
import { CellActivation } from "./CellActivation";
import { DRAG_TRANSITION, EMPTY_IDS } from "./constants";

/** One cell: its flat content sequence renders through the flat sequence renderer. */
const TableCell = memo(function TableCell({
  id,
  dragX,
  dragShifted,
}: {
  id: BlockId;
  dragX: number;
  dragShifted: boolean;
}) {
  const cell = useBlock(id);
  const children = cell !== undefined && cell.type === "table-cell" ? (cell.children ?? EMPTY_IDS) : EMPTY_IDS;
  const contextValue = useBlockContextValue(id, children, "table-cell");
  if (cell === undefined || cell.type !== "table-cell") return null;
  // The cell background: the column color over the row color (the column
  // wins; removing it reveals the row's color).
  const background = cell.attrs?.columnColor ?? cell.attrs?.rowColor;
  const style: CSSProperties = {
    ...(background !== undefined ? { background } : {}),
    ...(dragX !== 0
      ? {
          transform: `translateX(${dragX}px)`,
          position: "relative" as const,
          zIndex: dragShifted ? undefined : 10,
          transition: dragShifted ? DRAG_TRANSITION : undefined,
        }
      : {}),
  };
  // The cell's own content (the text-cell shape: the runs stand in
  // addition to the children blocks) renders as an editable layer above
  // the children; a wholly empty cell takes the activation layer.
  const hasOwnText = (cell.content ?? []).some((run) => run.text !== "");
  return (
    <td
      data-slot="docblocks/table-cell"
      data-block-id={id}
      className="
        border-(length:--docblocks-table-border-width) border-(--docblocks-table-border-color)
        p-(--docblocks-table-cell-padding) align-top
      "
      style={style}
    >
      <BlockContext.Provider value={contextValue}>
        {hasOwnText ? <CellContent id={id} block={cell} /> : null}
        {children.length === 0 && !hasOwnText ? <CellActivation cellId={id} /> : <BlockGroups ids={children} />}
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
  const { doc } = useEditorContext();
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
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      data-slot="docblocks/block-content"
      data-block-id={id}
      className={cn(
        "m-0 whitespace-pre-wrap outline-none",
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
