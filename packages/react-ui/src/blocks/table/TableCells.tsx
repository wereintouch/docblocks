/** The table's row / cell renderers (the drag transforms, the cell
 * backgrounds) and the cell's own-content layer + the empty-cell
 * activation layer. */
import { memo, useEffect, useRef } from "react";
import type { CSSProperties, ClipboardEvent, KeyboardEvent } from "react";

import { BLOCK_REGISTRY } from "docblocks-core";
import type { Block, BlockId } from "docblocks-core";

import { focusCaretIn, focusCellActivation } from "../../editing/block-commands";
import { plainTextOfHtml } from "../../editing/clipboard";
import { useEditorContext } from "../../editor-provider";
import { useBlock } from "../../hooks";
import { cn } from "../../shared/ui/cn";
import { BlockGroups } from "../BlockView";
import { BlockContext, useBlockContext, useBlockContextValue } from "../block-context";
import { useTextInner } from "../text-inner";
import { EMPTY_IDS } from "./constants";

/** One row: the cell ids come from the row's own snapshot. */
const TableRow = memo(function TableRow({
  id,
  rowTransform,
  columnTransforms,
  dimmed,
}: {
  id: BlockId;
  rowTransform: { dy: number; shifted: boolean };
  columnTransforms: Array<{ dx: number; shifted: boolean }>;
  dimmed: boolean;
}) {
  const row = useBlock(id);
  const cells = row !== undefined && row.type === "table-row" ? (row.children ?? EMPTY_IDS) : EMPTY_IDS;
  const contextValue = useBlockContextValue(id, cells, "table-row");
  if (row === undefined || row.type !== "table-row") return null;
  const dragging = rowTransform.dy !== 0;
  return (
    <tr
      data-block-id={id}
      style={
        dragging || dimmed
          ? {
              ...(dragging
                ? {
                    transform: `translateY(${rowTransform.dy}px)`,
                    position: "relative" as const,
                    zIndex: rowTransform.shifted ? undefined : 10,
                    transition: rowTransform.shifted ? "transform 120ms ease-out" : undefined,
                  }
                : {}),
              ...(dimmed ? { opacity: 0.4 } : {}),
            }
          : undefined
      }
    >
      <BlockContext.Provider value={contextValue}>
        {cells.map((cellId, cellIndex) => (
          <TableCell
            key={cellId}
            id={cellId}
            dragX={columnTransforms[cellIndex]?.dx ?? 0}
            dragShifted={columnTransforms[cellIndex]?.shifted ?? false}
          />
        ))}
      </BlockContext.Provider>
    </tr>
  );
});
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
          transition: dragShifted ? "transform 120ms ease-out" : undefined,
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
      className="border-(length:--docblocks-table-border-width) border-(--docblocks-table-border-color) p-(--docblocks-table-cell-padding) align-top"
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
      onFocus={() => {
        focusInRef.current = true;
        scopeRef.current = innerRef.current?.closest<HTMLElement>("[data-slot='docblocks/editor']") ?? document;
      }}
      onBlur={() => {
        focusInRef.current = false;
      }}
      onInput={onInput}
      onPaste={onPaste}
      onKeyDown={onKeydown}
    />
  );
}
/**
 * The empty-cell activation layer: a local contenteditable that holds the
 * caret while the cell holds no blocks. Nothing is written to the doc while
 * the layer stands (the cell stays data-empty — no wire traffic); the
 * FIRST input (or paste) materializes a paragraph with the typed text in
 * one transaction (one undo step, one wire update). When a paragraph
 * arrives concurrently (a peer activated the same cell before the input
 * committed), the input lands in the existing first paragraph instead of
 * inserting a new one — the empty paragraphs do not multiply.
 *
 * The layer's own content is never doc-derived (the store rebuild swaps it
 * for the real paragraph as soon as the cell holds one), so the input
 * commits the whole textContent and clears the local DOM; the caret re-
 * seats in the materialized paragraph on the next frame. A first input
 * mid-IME-composition materializes the paragraph and unmounts the layer,
 * canceling the composition session — the v1 IME limitation stands (the
 * text-block layer carries the same known limit).
 */
function CellActivation({ cellId }: { cellId: BlockId }) {
  const { doc } = useEditorContext();
  const ref = useRef<HTMLDivElement | null>(null);

  /**
   * Materializes the paragraph with `content` (or merges into a
   * concurrently arrived one) and seats the caret at its end on the next
   * frame (the store-driven swap renders the real paragraph first).
   */
  const materialize = (content: string) => {
    const scope = ref.current?.closest<HTMLElement>('[data-slot="docblocks/editor"]') ?? document;
    // The seat target survives the transact via a property (a closure-
    // assigned variable is not flow-narrowed past the call).
    const seat: { target: { blockId: BlockId; offset: number } | null } = { target: null };
    try {
      doc.transact(() => {
        const children = doc.getChildren(cellId);
        if (children.length === 0) {
          const paragraph = doc.insertBlock("paragraph", undefined, { parent: cellId });
          doc.insertText(paragraph, 0, content);
          seat.target = { blockId: paragraph, offset: content.length };
        } else {
          const first = children[0]!;
          const length = doc.getTextLength(first);
          doc.insertText(first, length, content);
          seat.target = { blockId: first, offset: length + content.length };
        }
      });
    } catch {
      // A rejected insertion (the cell re-parented mid-gesture): the local
      // text is restored into the layer and the gesture is a no-op.
      const el = ref.current;
      if (el !== null) el.textContent = content;
      return;
    }
    if (seat.target !== null) focusCaretIn(seat.target.blockId, seat.target.offset, scope);
  };

  const onInput = () => {
    const el = ref.current;
    if (el === null) return;
    const text = el.textContent ?? "";
    el.textContent = "";
    if (text === "") return;
    materialize(text);
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    // The cell paste is plain text only (the markdown pipeline degrades to
    // a single paragraph in a cell; the browser's rich insertion is
    // suppressed): multi-line text stands as soft breaks; an HTML-only
    // payload degrades to its text (the marks are dropped).
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    const html = event.clipboardData.getData("text/html");
    const plain = text !== "" ? text : html !== "" ? plainTextOfHtml(html) : "";
    if (plain === "") return;
    materialize(plain.replace(/\r\n?/g, "\n"));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Enter in a cell is a soft line break; the empty layer has no block to
    // break, so the key is a no-op (the browser's <div>/<br> insertion is
    // suppressed — the layer stays content-free until the first input).
    // An IME-composed Enter commits the candidate and flows to onInput.
    if (event.key === "Enter" && !event.nativeEvent.isComposing) event.preventDefault();
  };

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      data-slot="docblocks/cell-activation"
      className="m-0 min-w-full whitespace-pre-wrap outline-none"
      onInput={onInput}
      onPaste={onPaste}
      onKeyDown={onKeyDown}
    />
  );
}

export { CellActivation, CellContent, TableCell, TableRow };
