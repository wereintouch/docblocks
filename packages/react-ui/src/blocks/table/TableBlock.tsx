/**
 * A table: one <tr> per row block, one <td> per cell; each cell renders
 * its flat content sequence (a page context) through the flat sequence
 * renderer, so a paragraph cell is editable via the text block path. An
 * EMPTY cell renders the activation layer (a local editable that holds the
 * caret without writing to the doc; the first input materializes the
 * paragraph) instead of a child paragraph — an empty cell has no data.
 *
 * Layout: the width is the sum of the column widths (the `columnWidths`
 * attr; an absent entry falls back to the default) under `table-fixed`; a
 * wider-than-the-page table scrolls horizontally. The cell background is
 * the column color over the row color (the column wins).
 *
 * The chrome stands over the gesture modules: the handles' reorder drag +
 * the menu (`TableHandles` + `use-table-handle-drag` +
 * `use-table-handle-actions`), the seams' resize + the add-column chip
 * (`TableSeams` + `use-table-seam-resize`), the frame's add-row chip / the
 * size's stand / the cell's right-click menu (`TableFrameChrome`), the
 * add chips' multi drag + the click-guard (`use-table-add-chips`), the
 * cell menu's gesture + commands (`use-table-cell-menu`); the drag
 * preview's math over `table-drag-transforms`, the live DOM's metrics
 * over `use-table-metrics`.
 */
import { useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { DEFAULT_TABLE_COLUMN_WIDTH } from "docblocks-core";
import type { BlockId, TableBlock as TableBlockType } from "docblocks-core";

import { useEditorContext } from "../../editor-provider";
import { BlockContext, useBlockContextValue } from "../../shared/providers/block-context";
import { useFormatPalette } from "../../shared/providers/format-palette-context";
import { TableFrameChrome } from "./TableFrameChrome";
import { TableHandles } from "./TableHandles";
import { TableRow } from "./TableRow";
import { TableSeams } from "./TableSeams";
import { EMPTY_IDS, GHOST_ROW_HEIGHT, TABLE_ELEMENT_QUERY } from "./constants";
import type { AddChipSession, ColumnResizeSession, HandleKind, TableHandleSession } from "./models";
import { columnCentersOf, columnDragTransformOf, rowDragTransformOf, seamXsOf } from "./table-drag-transforms";
import { useTableAddChips } from "./use-table-add-chips";
import { useTableCellMenu } from "./use-table-cell-menu";
import { useTableHandleActions } from "./use-table-handle-actions";
import { useTableHandleDrag } from "./use-table-handle-drag";
import { useTableMetrics } from "./use-table-metrics";
import { useTableSeamResize } from "./use-table-seam-resize";

function TableBlock({ id, block }: { id: BlockId; block: TableBlockType }) {
  const { doc, viewMode } = useEditorContext();
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
  const { resizePreview, onSeamPointerDown, onSeamPointerMove, onSeamPointerUp, onSeamPointerCancel, onSeamKeyDown } =
    useTableSeamResize({ docWidths, doc, id, resizeSessionRef });
  const widths =
    resizePreview !== null
      ? docWidths.map((width, i) => (i === resizePreview.col - 1 ? resizePreview.width : width))
      : docWidths;
  const tableWidth = widths.reduce((sum, width) => sum + width, 0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<{ row: number; col: number } | null>(null);
  const [menu, setMenu] = useState<{ kind: HandleKind; index: number } | null>(null);
  const sessionRef = useRef<TableHandleSession | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
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

  const {
    insertTableColumn,
    insertTableRow,
    onAddChipPointerDown,
    onAddChipPointerMove,
    onAddChipPointerUp,
    onAddChipPointerCancel,
  } = useTableAddChips({
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

  const { rowButtonLeft, rowMetrics } = useTableMetrics({ scrollRef, tableWidth, rows });

  // The table element (the live DOM — the commit and the hover math read it).
  const tableEl = () => scrollRef.current?.querySelector<HTMLTableElement>(TABLE_ELEMENT_QUERY) ?? null;

  const { preview, onHandlePointerDown, onHandlePointerMove, onHandlePointerUp, onHandlePointerCancel } =
    useTableHandleDrag({ sessionRef, setHover, setMenu, tableEl, doc, rows, block, id });

  // The hovered cell under the pointer (the handle hover zone is the whole
  // row and column); a pointer over the handle zone / the padding keeps the
  // current hover.
  const onContentPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const cell = target.closest<HTMLTableCellElement>("td[data-block-id]");
    if (cell === null) return;
    const row = cell.closest<HTMLTableRowElement>("tr[data-block-id]");
    if (row === null) return;
    const next = { row: row.rowIndex, col: cell.cellIndex };
    setHover((prev) => (prev !== null && prev.row === next.row && prev.col === next.col ? prev : next));
  };

  const { ctx, closeCtx, onCellClear, onCellCopy, onCellPaste, onTableContextMenu } = useTableCellMenu({
    doc,
    viewMode,
    frameRef,
  });
  const { onColumnHandleAction, onColumnHandleColor, onRowHandleAction, onRowHandleColor } = useTableHandleActions({
    doc,
    rows,
    tableBlockId: id,
    setMenu,
    scrollRef,
  });

  // The column handles' horizontal centers (the widths are the layout
  // source — no DOM measurement for the columns) + the column seams' x.
  const columnCenters = columnCentersOf(widths);
  const seamXs = seamXsOf(widths);

  // A structural change (a peer insert/remove/move) while a menu is open
  // invalidates its index-based anchor: the menu closes (a re-anchored chip
  // would act on the wrong target; local actions close before the doc
  // changes, so this fires on concurrent changes only).
  const structureKey = `${block.columnOrder.length}:${rows.join(",")}`;
  const prevStructureKey = useRef(structureKey);
  useLayoutEffect(() => {
    if (menu !== null && prevStructureKey.current !== structureKey) setMenu(null);
    prevStructureKey.current = structureKey;
  }, [structureKey, menu]);

  // The table's rendered height (the row metrics' last bottom) — the
  // add-column chip centers on the table, not the content (the 20 px handle
  // band above would skew the content's center).
  const tableHeight =
    rowMetrics.length > 0 ? rowMetrics[rowMetrics.length - 1]!.top + rowMetrics[rowMetrics.length - 1]!.height : 0;
  const columnTransforms = widths.map((_, index) => columnDragTransformOf(preview, index));

  const clearHover = () => setHover(null);
  const closeMenu = (open: boolean) => {
    if (!open) setMenu(null);
  };
  // The handle's keyboard open (the Enter / Space): the controlled state
  // stand — the pointer's open stands the drag hook's release.
  const openHandleMenu = (kind: HandleKind) => (index: number) => () => setMenu({ kind, index });

  return (
    <div
      ref={frameRef}
      data-slot="docblocks/table-scroll"
      // The island's boundary: the cell's editables sit behind this
      // non-editable wrapper (the browser focuses the cell's own inner,
      // the cell's keys stand their own handlers) and the table's chrome
      // is out of the page's editable flow.
      contentEditable={false}
      className="group relative my-(--docblocks-block-spacing)"
    >
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
                    rowTransform={rowDragTransformOf(preview, rowIndex)}
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
          {/* The read-only stand (view / published): the table's editing
              chrome (the handles, the seams, the add chips, the cell's
              context menu) stands no stand — the grid stands read-only. */}
          {!viewMode && (
            <>
              <TableHandles
                tableId={id}
                widths={widths}
                rows={rows}
                rowMetrics={rowMetrics}
                hover={hover}
                menu={menu}
                preview={preview}
                columnCenters={columnCenters}
                onHandlePointerDown={onHandlePointerDown}
                onHandlePointerMove={onHandlePointerMove}
                onHandlePointerUp={onHandlePointerUp}
                onHandlePointerCancel={onHandlePointerCancel}
                openHandleMenu={openHandleMenu}
                onMenuOpenChange={closeMenu}
                onColumnHandleAction={onColumnHandleAction}
                onRowHandleAction={onRowHandleAction}
                onColumnHandleColor={onColumnHandleColor}
                onRowHandleColor={onRowHandleColor}
                palette={palette}
              />
              <TableSeams
                widths={widths}
                tableWidth={tableWidth}
                tableHeight={tableHeight}
                seamXs={seamXs}
                resizePreview={resizePreview}
                addPreview={addPreview}
                onSeamPointerDown={onSeamPointerDown}
                onSeamPointerMove={onSeamPointerMove}
                onSeamPointerUp={onSeamPointerUp}
                onSeamPointerCancel={onSeamPointerCancel}
                onSeamKeyDown={onSeamKeyDown}
                onAddChipPointerDown={onAddChipPointerDown}
                onAddChipPointerMove={onAddChipPointerMove}
                onAddChipPointerUp={onAddChipPointerUp}
                onAddChipPointerCancel={onAddChipPointerCancel}
                insertTableColumn={insertTableColumn}
              />
            </>
          )}
        </div>
      </div>
      <TableFrameChrome
        viewMode={viewMode}
        insertTableRow={insertTableRow}
        onAddChipPointerDown={onAddChipPointerDown}
        onAddChipPointerMove={onAddChipPointerMove}
        onAddChipPointerUp={onAddChipPointerUp}
        onAddChipPointerCancel={onAddChipPointerCancel}
        rowButtonLeft={rowButtonLeft}
        addPreview={addPreview}
        columnCount={block.columnOrder.length}
        rowCount={rows.length}
        cellMenu={{
          ctx,
          onOpenChange: closeCtx,
          onCopy: onCellCopy,
          onPaste: onCellPaste,
          onClear: onCellClear,
        }}
      />
    </div>
  );
}

export { TableBlock };
