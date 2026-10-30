/**
 * A table: one <tr> per row block, one <td> per cell; each cell renders
 * its flat content sequence (a page context: the `indent` attr carries
 * the nesting) through the flat sequence renderer, so a paragraph cell is
 * editable via the text block path. The block context is provided at each
 * level (rows under the table, cells under the row, contents under the
 * cell) with the parent's type (the cell context drives the cell gestures:
 * the Enter soft break, the Backspace no-op, the plain paste). An EMPTY
 * cell renders the activation layer (a local editable that holds the
 * caret without writing to the doc; the first input materializes the
 * paragraph) instead of a child paragraph — an empty cell has no data.
 *
 * Layout: the table's width is the sum of the column widths (the
 * `columnWidths` attr; an absent entry falls back to the default width)
 * under `table-fixed` — the text wraps and the row height adapts. A
 * wider-than-the-page table scrolls horizontally (the thin scrollbar).
 * The cell background is the column color over the row color (both layers
 * stand in the cell attrs; the column wins, removing it reveals the row's
 * color).
 *
 * The row/column handles: hovering a cell reveals the column handle (above
 * the column) and the row handle (left of the row). A press and drag
 * reorders (the live preview is a transform on the dragged row/cell; the
 * release commits moveTableRow / moveTableColumn — one command; a stale
 * drop issues none). A press without a drag opens the handle's menu (the
 * background color palette with the conditional remove, insert / move /
 * duplicate / clear / delete). The add-row / add-column chips
 * (hover/focus-revealed, like the code header's controls) drive the core's
 * insert commands: the add-column chip stands at the table's right edge and
 * scrolls with it; the add-row chip stands below the table, centered on
 * the visible part of it (the table's center when it fits, the editor's
 * center when part of the table is scrolled out). A chip press and drag
 * adds or removes SEVERAL at once (the vertical delta for the rows, the
 * horizontal for the columns, one per 24 px — down / right adds, up /
 * left removes the last N, the floor keeps one; the live preview stands
 * the ghost rows / columns or the dimmed last ones, view state only; the
 * release commits the count in one transact, the stale guard stands the
 * handle's contract). The size stand (the columns × the rows) stands the
 * frame's top-left corner.
 */
import { useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

import type { BlockId, TableBlock as TableBlockType } from "docblocks-core";
import { DEFAULT_TABLE_COLUMN_WIDTH } from "docblocks-core";

import { focusCaretIn } from "../../editing/block-commands";
import { useEditorContext } from "../../editor-provider";
import { Button } from "../../shared/ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../shared/ui/DropdownMenu";
import { cn } from "../../shared/ui/cn";
import { Plus } from "../../shared/ui/icons";
import { preventDefault } from "../../shared/utils";
import { BlockContext, useBlockContextValue } from "../block-context";
import { useFormatPalette } from "../format-palette-context";
import { HandleMenu, HandleMenuItems } from "./HandleMenu";
import { TableRow } from "./TableRow";
import {
  ADD_BUTTON_CLASSES,
  ADD_BUTTON_SIZE,
  EMPTY_IDS,
  GHOST_ROW_HEIGHT,
  HANDLE_SIZE,
  HANDLE_ZONE,
} from "./constants";
import type { AddChipSession, ColumnResizeSession, HandleAction, HandleKind, TableHandleSession } from "./models";
import { useTableAddChips } from "./use-table-add-chips";
import { useTableHandleDrag } from "./use-table-handle-drag";
import { useTableSeamResize } from "./use-table-seam-resize";
import { cellPlainText, pasteCellText, readClipboardText } from "./utils";

function TableBlock({ id, block }: { id: BlockId; block: TableBlockType }) {
  const { doc } = useEditorContext();
  const palette = useFormatPalette();
  const rows = block.children ?? EMPTY_IDS;
  const contextValue = useBlockContextValue(id, rows, "table");
  // The doc's column widths and the rendered ones (the resize drag's live
  // preview overrides the dragged column locally — no wire traffic until
  // the release commits the width).
  const docWidths = Array.from(
    { length: block.columnOrder.length },
    (_, index) => block.attrs?.columnWidths?.[index] ?? DEFAULT_TABLE_COLUMN_WIDTH
  );
  // The column-seam's resize session (shared with the add chip's + the
  // handle's guards — a press starts at most one session at a time).
  const resizeSessionRef = useRef<ColumnResizeSession | null>(null);
  const { resizePreview, onSeamPointerDown, onSeamPointerMove, onSeamPointerUp, onSeamPointerCancel } =
    useTableSeamResize({ docWidths, doc, id, resizeSessionRef });
  const widths =
    resizePreview !== null
      ? docWidths.map((width, i) => (i === resizePreview.col - 1 ? resizePreview.width : width))
      : docWidths;
  const tableWidth = widths.reduce((sum, width) => sum + width, 0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [rowButtonLeft, setRowButtonLeft] = useState(0);
  const [hover, setHover] = useState<{ row: number; col: number } | null>(null);
  const [menu, setMenu] = useState<{ kind: HandleKind; index: number } | null>(null);
  const [rowMetrics, setRowMetrics] = useState<{ top: number; height: number }[]>([]);
  const sessionRef = useRef<TableHandleSession | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  // The cell context menu (the right-click): the anchor point (frame-relative)
  // and the cell; the menu's content carries the copy/paste/clear items.
  const [ctx, setCtx] = useState<{ x: number; y: number; cellId: BlockId } | null>(null);
  // The add chip's drag session + the live count's preview (positive = the
  // ghost rows / columns, negative = the dimmed last ones) — view state:
  // the doc stands the commit on the release only.
  const addSessionRef = useRef<AddChipSession | null>(null);
  const [addPreview, setAddPreview] = useState<{ kind: HandleKind; count: number } | null>(null);
  // The click that follows the drag's release (the pointer capture keeps
  // the click on the chip): the chip's onClick skips it (the visual stood
  // the drag's outcome — the multi-commit or the no-op — either way the
  // click must not insert a stray one).
  const addDragClickRef = useRef(false);

  const { onAddChipPointerDown, onAddChipPointerMove, onAddChipPointerUp, onAddChipPointerCancel } = useTableAddChips({
    addSessionRef,
    sessionRef,
    resizeSessionRef,
    addDragClickRef,
    setAddPreview,
    doc,
    rows,
    block,
    id,
  });

  // The add-row chip's left offset: the center of the visible part of the
  // table (no scroll listeners — the chip is pinned to the frame, not the
  // scrolled content). jsdom has no ResizeObserver; the offset stays 0.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    const update = () => setRowButtonLeft(Math.max(0, Math.min(tableWidth, el.clientWidth) / 2 - ADD_BUTTON_SIZE / 2));
    update();
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(update);
      observer.observe(el);
      return () => observer.disconnect();
    }
  }, [tableWidth]);

  // The row handles' vertical centering: the row offsets/heights measured
  // from the live DOM (the heights are auto per the wrapped content) —
  // remeasured on the structure/width change and on any table resize.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const table = el?.querySelector<HTMLTableElement>('table[data-slot="docblocks/table"]');
    if (el === null || table === null || table === undefined) return;
    const measure = () =>
      setRowMetrics(
        Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody > tr")).map((tr) => ({
          top: tr.offsetTop,
          height: tr.offsetHeight,
        }))
      );
    measure();
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(measure);
      observer.observe(table);
      return () => observer.disconnect();
    }
  }, [rows, tableWidth]);

  /** The table element (the live DOM — the commit and the hover math read it). */
  const tableEl = () =>
    scrollRef.current?.querySelector<HTMLTableElement>('table[data-slot="docblocks/table"]') ?? null;

  const { preview, onHandlePointerDown, onHandlePointerMove, onHandlePointerUp, onHandlePointerCancel } =
    useTableHandleDrag({ sessionRef, setHover, setMenu, tableEl, doc, rows, block, id });

  /**
   * The hovered cell under the pointer (the handle hover zone is the whole
   * row and column); a pointer over the handle zone / the padding keeps
   * the current hover.
   */
  const onContentPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const cell = target.closest<HTMLTableCellElement>("td[data-block-id]");
    if (cell === null) return;
    const row = cell.closest<HTMLTableRowElement>("tr[data-block-id]");
    if (row === null) return;
    const next = { row: row.rowIndex, col: cell.cellIndex };
    setHover((prev) => (prev !== null && prev.row === next.row && prev.col === next.col ? prev : next));
  };

  /**
   * The right-click on a cell: suppresses the native menu and anchors the
   * cell's menu (copy / paste / clear) at the pointer (frame-relative —
   * the anchor div stands in the frame, not the scrolled content).
   */
  const onTableContextMenu = (event: ReactMouseEvent<HTMLTableElement>) => {
    const cell = (event.target as HTMLElement).closest<HTMLTableCellElement>("td[data-block-id]");
    if (cell === null) return;
    const frame = frameRef.current;
    const rect = frame?.getBoundingClientRect();
    if (rect === undefined) return;
    event.preventDefault();
    // The open defers past the right-click's pointerup (the input order is
    // down → contextmenu → up): a synchronous open puts the first item under
    // the release point, and a Radix item treats an up without its own down
    // as a select — the release would "click" the first item and close the
    // menu. A task later (imperceptible for a context menu) stands clear of
    // the gesture.
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const cellId = cell.dataset.blockId ?? "";
    window.setTimeout(() => setCtx({ x, y, cellId }), 0);
  };

  const cellScope = () => frameRef.current?.closest<HTMLElement>('[data-slot="docblocks/editor"]') ?? document;

  /** The copy: the cell's plain text to the clipboard (the blocks joined
   * with the line break); an unreadable clipboard stands a no-op (v1). */
  const onCellCopy = async () => {
    if (ctx === null) return;
    const text = cellPlainText(doc, ctx.cellId);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // The page may not hold the write (permissions) — the v1 no-op.
    }
  };

  /** The paste: the clipboard's plain text into the cell (the seat is the
   * last text child's end; an empty cell materializes its paragraph) —
   * the caret seats in the landed text. */
  const onCellPaste = async () => {
    if (ctx === null) return;
    const text = await readClipboardText();
    if (text === "") return;
    const seat = pasteCellText(doc, ctx.cellId, text);
    if (seat !== null) focusCaretIn(seat.blockId, seat.offset, cellScope());
  };

  /** The clear: the cell's own content and the children cascade out
   * (one transact, one undo step); the cell stands the activation layer. */
  const onCellClear = () => {
    if (ctx === null) return;
    try {
      doc.transact(() => {
        const cell = doc.getBlock(ctx.cellId);
        if (cell === null || cell.type !== "table-cell") return;
        const ownLength = doc.getTextLength(ctx.cellId);
        if (ownLength > 0) doc.deleteText(ctx.cellId, 0, ownLength);
        for (const child of cell.children ?? []) doc.removeBlock(child);
      });
    } catch {
      // A rejected removal (the cell re-parented mid-gesture): no-op.
    }
  };

  /** The handle's menu action (the item's doc command; the last-row/column
   * delete converts the table into a paragraph — the caret seats in it). */
  const handleAction = (kind: HandleKind, index: number, action: HandleAction) => {
    const rowId = rows[index] ?? "";
    try {
      switch (action) {
        case "insert-after":
          if (kind === "column") doc.insertTableColumn(id, index + 1);
          else doc.insertTableRow(id, index + 1);
          break;
        case "insert-before":
          if (kind === "column") doc.insertTableColumn(id, index);
          else doc.insertTableRow(id, index);
          break;
        case "move-next":
          // The core's pre-move target index: one slot down/right is
          // `index + 2` (the row's own slot is `index + 1`); one up/left is
          // `index - 1`.
          if (kind === "column") doc.moveTableColumn(id, index, index + 2);
          else doc.moveTableRow(id, rowId, index + 2);
          break;
        case "move-prev":
          if (kind === "column") doc.moveTableColumn(id, index, index - 1);
          else doc.moveTableRow(id, rowId, index - 1);
          break;
        case "duplicate":
          if (kind === "column") doc.duplicateTableColumn(id, index);
          else doc.duplicateTableRow(id, rowId);
          break;
        case "clear":
          if (kind === "column") doc.clearTableColumn(id, index);
          else doc.clearTableRow(id, rowId);
          break;
        case "remove": {
          if (kind === "column") doc.removeTableColumn(id, index);
          else doc.removeTableRow(id, rowId);
          const converted = doc.getBlock(id);
          if (converted !== null && converted.type === "paragraph") {
            const scope = scrollRef.current?.closest<HTMLElement>('[data-slot="docblocks/editor"]') ?? document;
            focusCaretIn(id, 0, scope);
          }
          break;
        }
      }
    } catch {
      // A rejected command (a concurrent structural change won the race):
      // the doc stands as-is, the menu closes on the selection anyway.
    }
  };

  /** The background color set/remove (the palette swatches and the remove item). */
  const handleSetColor = (kind: HandleKind, index: number, color: string | null) => {
    const rowId = rows[index] ?? "";
    try {
      if (kind === "column") doc.setTableColumnColor(id, index, color);
      else doc.setTableRowColor(id, rowId, color);
    } catch {
      // A rejected command (a concurrent structural change won the race).
    }
  };

  // The column handles' horizontal centers (the widths are the layout
  // source — no DOM measurement for the columns).
  const columnCenters: number[] = [];
  {
    let acc = HANDLE_ZONE;
    for (const width of widths) {
      columnCenters.push(acc + width / 2);
      acc += width;
    }
  }

  // The column seams' x (seam i stands at the LEFT edge of column i — the
  // boundary between column i-1 and i; a seam resizes the column to its
  // LEFT, the first column's left edge has no seam). The rendered seams
  // stand at every column's RIGHT edge (the boundary of col + 1, or the
  // table's right edge for the last column).
  const seamXs: number[] = [];
  {
    let acc = HANDLE_ZONE;
    for (const width of widths) {
      seamXs.push(acc);
      acc += width;
    }
  }

  const isPreview = (kind: HandleKind, index: number): boolean =>
    preview !== null && preview.kind === kind && preview.index === index;

  // The parting preview: the stationary rows / columns' shift (px) over
  // the live drop index (the dragged row / column's own cells stand the
  // pointer's dx / dy).
  const previewShift = (index: number): number => {
    if (preview === null || preview.toIndex === null || index === preview.index) return 0;
    const to = preview.toIndex;
    const shift = index < preview.index ? (index >= to ? 1 : 0) : index - 1 < to ? -1 : 0;
    return shift * preview.startSize;
  };
  /** The per-column drag transform (the cells' dx): the dragged column's live dx, the stationary columns' parting shift. */
  const columnDragTransformOf = (index: number): { dx: number; shifted: boolean } => {
    if (preview === null || preview.kind !== "column") return { dx: 0, shifted: false };
    if (index === preview.index) return { dx: preview.dx, shifted: false };
    return { dx: previewShift(index), shifted: true };
  };
  /** The per-row drag transform (the rows' dy): the dragged row's live dy, the stationary rows' parting shift. */
  const rowDragTransformOf = (index: number): { dy: number; shifted: boolean } => {
    if (preview === null || preview.kind !== "row") return { dy: 0, shifted: false };
    if (index === preview.index) return { dy: preview.dy, shifted: false };
    return { dy: previewShift(index), shifted: true };
  };

  // A structural change (a peer insert/remove/move) while a menu is open
  // invalidates its index-based anchor: the menu closes (the chip that stood
  // at the index re-anchored onto a different row/column would act on the
  // wrong target). Local menu actions close the menu through the selection
  // before the doc changes, so this fires on concurrent changes only.
  const structureKey = `${block.columnOrder.length}:${rows.join(",")}`;
  const prevStructureKey = useRef(structureKey);
  useLayoutEffect(() => {
    if (menu !== null && prevStructureKey.current !== structureKey) setMenu(null);
    prevStructureKey.current = structureKey;
  }, [structureKey, menu]);

  // The table's rendered height (the row metrics' last bottom) — the
  // add-column chip centers on the table, not on the content (the 20 px
  // handle band above the table would skew the content's center).
  const tableHeight =
    rowMetrics.length > 0 ? rowMetrics[rowMetrics.length - 1]!.top + rowMetrics[rowMetrics.length - 1]!.height : 0;
  const columnTransforms = widths.map((_, index) => columnDragTransformOf(index));

  const clearHover = () => setHover(null);
  // The handle menu's action / color commits stand the handle's kind +
  // index over the shared handle handlers (the map's per-item stand).
  const onColumnHandleAction =
    (index: number) =>
    (action: HandleAction): void =>
      handleAction("column", index, action);
  const onColumnHandleColor =
    (index: number) =>
    (color: string | null): void =>
      handleSetColor("column", index, color);
  const onRowHandleAction =
    (rowIndex: number) =>
    (action: HandleAction): void =>
      handleAction("row", rowIndex, action);
  const onRowHandleColor =
    (rowIndex: number) =>
    (color: string | null): void =>
      handleSetColor("row", rowIndex, color);
  const closeMenu = (open: boolean) => {
    if (!open) setMenu(null);
  };
  const closeCtx = (open: boolean) => {
    if (!open) setCtx(null);
  };

  return (
    <div ref={frameRef} data-slot="docblocks/table-scroll" className="group relative my-(--docblocks-block-spacing)">
      <div ref={scrollRef} className="scrollbar-thin [scrollbar-color:var(--border)_transparent] overflow-x-auto">
        <div className="relative w-max pt-5 pl-5" onPointerMove={onContentPointerMove} onPointerLeave={clearHover}>
          <table
            data-slot="docblocks/table"
            data-block-type="table"
            data-block-id={id}
            className="relative m-0 table-fixed border-collapse"
            style={{ width: tableWidth }}
            onContextMenu={onTableContextMenu}
          >
            <colgroup>
              {widths.map((width, index) => (
                <col key={index} style={{ width }} />
              ))}
            </colgroup>
            <tbody>
              <BlockContext.Provider value={contextValue}>
                {rows.map((rowId, rowIndex) => (
                  <TableRow
                    key={rowId}
                    id={rowId}
                    rowTransform={rowDragTransformOf(rowIndex)}
                    columnTransforms={columnTransforms}
                    dimmed={
                      addPreview !== null &&
                      addPreview.kind === "row" &&
                      addPreview.count < 0 &&
                      rowIndex >= rows.length + addPreview.count
                    }
                  />
                ))}
                {addPreview !== null && addPreview.kind === "row" && addPreview.count > 0
                  ? Array.from({ length: addPreview.count }, (_, i) => (
                      <tr key={`ghost-row-${i}`} aria-hidden data-slot="docblocks/table-ghost-row">
                        <td
                          colSpan={block.columnOrder.length}
                          className="
                            border-(length:--docblocks-table-border-width) border-dashed
                            border-(--docblocks-table-border-color) bg-muted/40
                          "
                          style={{ height: GHOST_ROW_HEIGHT }}
                        />
                      </tr>
                    ))
                  : null}
              </BlockContext.Provider>
            </tbody>
          </table>
          {widths.map((_, index) => (
            <HandleMenu
              key={`col-${index}`}
              kind="column"
              index={index}
              visible={
                isPreview("column", index) ||
                hover?.col === index ||
                (menu !== null && menu.kind === "column" && menu.index === index)
              }
              left={columnCenters[index]! - HANDLE_SIZE / 2}
              top={0}
              open={menu !== null && menu.kind === "column" && menu.index === index}
              onOpenChange={closeMenu}
              dragging={isPreview("column", index)}
              dragDx={columnDragTransformOf(index).dx}
              dragTransition={columnDragTransformOf(index).shifted}
              dragDy={0}
              onPointerDown={onHandlePointerDown("column", index)}
              onPointerMove={onHandlePointerMove}
              onPointerUp={onHandlePointerUp}
              onPointerCancel={onHandlePointerCancel}
            >
              <HandleMenuItems
                tableId={id}
                kind="column"
                index={index}
                palette={palette}
                atStart={index === 0}
                atEnd={index === widths.length - 1}
                onAction={onColumnHandleAction(index)}
                onColor={onColumnHandleColor(index)}
              />
            </HandleMenu>
          ))}
          {rows.map((_, rowIndex) => (
            <HandleMenu
              key={`row-${rows[rowIndex] ?? rowIndex}`}
              kind="row"
              index={rowIndex}
              visible={
                isPreview("row", rowIndex) ||
                hover?.row === rowIndex ||
                (menu !== null && menu.kind === "row" && menu.index === rowIndex)
              }
              left={0}
              top={
                HANDLE_ZONE +
                (rowMetrics[rowIndex]?.top ?? 0) +
                (rowMetrics[rowIndex]?.height ?? 0) / 2 -
                HANDLE_SIZE / 2
              }
              open={menu !== null && menu.kind === "row" && menu.index === rowIndex}
              onOpenChange={closeMenu}
              dragging={isPreview("row", rowIndex)}
              dragDx={0}
              dragDy={rowDragTransformOf(rowIndex).dy}
              dragTransition={rowDragTransformOf(rowIndex).shifted}
              onPointerDown={onHandlePointerDown("row", rowIndex)}
              onPointerMove={onHandlePointerMove}
              onPointerUp={onHandlePointerUp}
              onPointerCancel={onHandlePointerCancel}
            >
              <HandleMenuItems
                tableId={id}
                kind="row"
                index={rowIndex}
                palette={palette}
                atStart={rowIndex === 0}
                atEnd={rowIndex === rows.length - 1}
                onAction={onRowHandleAction(rowIndex)}
                onColor={onRowHandleColor(rowIndex)}
              />
            </HandleMenu>
          ))}
          {widths.map((_, col) => {
            // The seam stands at the column's RIGHT edge (the interior
            // boundary, or the table's right edge for the last column —
            // the last column resizes there too).
            const seamIndex = col + 1;
            const x =
              col + 1 < widths.length ? (seamXs[seamIndex] ?? HANDLE_ZONE + tableWidth) : HANDLE_ZONE + tableWidth;
            return (
              <div
                key={`seam-${seamIndex}`}
                data-slot="docblocks/table-col-resize"
                data-index={col}
                className={cn(
                  `
                    absolute flex w-1.5 -translate-x-1/2 cursor-col-resize items-stretch justify-center opacity-0
                    transition-opacity
                    hover:opacity-100
                  `,
                  resizePreview?.col === seamIndex && "opacity-100"
                )}
                style={{ left: x, top: HANDLE_ZONE, height: tableHeight }}
                onPointerDown={onSeamPointerDown(seamIndex)}
                onPointerMove={onSeamPointerMove}
                onPointerUp={onSeamPointerUp}
                onPointerCancel={onSeamPointerCancel}
              >
                <div
                  data-slot="docblocks/table-col-resize-line"
                  className="h-full w-0.5 rounded bg-(--muted-foreground)"
                />
              </div>
            );
          })}
          {addPreview !== null && addPreview.kind === "column" && addPreview.count > 0
            ? Array.from({ length: addPreview.count }, (_, i) => (
                <div
                  key={`ghost-col-${i}`}
                  aria-hidden
                  data-slot="docblocks/table-ghost-column"
                  className="pointer-events-none absolute border-dashed border-border bg-muted/40"
                  style={{
                    left: HANDLE_ZONE + tableWidth + i * DEFAULT_TABLE_COLUMN_WIDTH,
                    top: HANDLE_ZONE,
                    width: DEFAULT_TABLE_COLUMN_WIDTH,
                    height: tableHeight,
                  }}
                />
              ))
            : null}
          {addPreview !== null && addPreview.kind === "column" && addPreview.count < 0
            ? Array.from({ length: -addPreview.count }, (_, i) => {
                const col = widths.length - 1 - i;
                const left = HANDLE_ZONE + widths.slice(0, col).reduce((sum, w) => sum + w, 0);
                return (
                  <div
                    key={`ghost-col-remove-${i}`}
                    aria-hidden
                    data-slot="docblocks/table-ghost-column-remove"
                    className="pointer-events-none absolute bg-(--muted-foreground)/30"
                    style={{ left, top: HANDLE_ZONE, width: widths[col] ?? 0, height: tableHeight }}
                  />
                );
              })
            : null}
          <Button
            type="button"
            data-slot="docblocks/table-add-column"
            aria-label="Add column"
            variant="ghost"
            size="icon"
            onClick={() => {
              if (addDragClickRef.current) {
                addDragClickRef.current = false;
                return;
              }
              doc.insertTableColumn(id);
            }}
            onPointerDown={onAddChipPointerDown("column")}
            onPointerMove={onAddChipPointerMove}
            onPointerUp={onAddChipPointerUp}
            onPointerCancel={onAddChipPointerCancel}
            className={cn(ADD_BUTTON_CLASSES, "absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full")}
            style={{
              left:
                HANDLE_ZONE +
                tableWidth +
                (addPreview !== null && addPreview.kind === "column" && addPreview.count > 0
                  ? addPreview.count * DEFAULT_TABLE_COLUMN_WIDTH
                  : 0),
              top: HANDLE_ZONE + tableHeight / 2,
            }}
          >
            <Plus />
          </Button>
        </div>
      </div>
      <Button
        type="button"
        data-slot="docblocks/table-add-row"
        aria-label="Add row"
        variant="ghost"
        size="icon"
        onClick={() => {
          if (addDragClickRef.current) {
            addDragClickRef.current = false;
            return;
          }
          doc.insertTableRow(id);
        }}
        onPointerDown={onAddChipPointerDown("row")}
        onPointerMove={onAddChipPointerMove}
        onPointerUp={onAddChipPointerUp}
        onPointerCancel={onAddChipPointerCancel}
        className={cn(ADD_BUTTON_CLASSES, "absolute top-full size-6 -translate-y-1/2 rounded-full")}
        style={{ left: rowButtonLeft }}
      >
        <Plus />
      </Button>
      {/* The table's size stand (the columns x the rows' RESULTING size):
          stands only during the add chips' drag (the add / remove's
          preview — the count stands nonzero), the frame's top-left
          corner (the handle band's free zone), muted. */}
      {addPreview !== null && addPreview.count !== 0 ? (
        <div
          data-slot="docblocks/table-size"
          aria-hidden
          className="pointer-events-none absolute top-0.5 left-1.5 text-xs text-(--muted-foreground) select-none"
        >
          {`${
            addPreview.kind === "column" ? block.columnOrder.length + addPreview.count : block.columnOrder.length
          } × ${addPreview.kind === "row" ? rows.length + addPreview.count : rows.length}`}
        </div>
      ) : null}
      {/* The cell's right-click menu: the 0×0 trigger stands at the pointer
          (frame-relative) while the menu is open — the content anchors to
          the cursor, like a native context menu. */}
      <DropdownMenu modal={false} open={ctx !== null} onOpenChange={closeCtx}>
        <DropdownMenuTrigger asChild>
          <div
            aria-hidden
            className="pointer-events-none absolute size-0"
            style={{ left: ctx?.x ?? 0, top: ctx?.y ?? 0 }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          data-slot="docblocks/table-cell-menu"
          aria-label="Cell options"
          sideOffset={4}
          onFocusOutside={preventDefault}
        >
          <DropdownMenuItem onSelect={onCellCopy}>Copy</DropdownMenuItem>
          <DropdownMenuItem onSelect={onCellPaste}>Paste</DropdownMenuItem>
          <DropdownMenuItem onSelect={onCellClear}>Clear</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export { TableBlock };
