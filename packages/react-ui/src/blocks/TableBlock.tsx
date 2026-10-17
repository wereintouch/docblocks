import { useStore } from "zustand";

import { memo, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ClipboardEvent, KeyboardEvent, ReactNode, PointerEvent as ReactPointerEvent } from "react";

import type { BlockId, TableBlock as TableBlockType } from "docblocks-core";
import { DEFAULT_TABLE_COLUMN_WIDTH } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import { focusCaretIn } from "../editing/block-commands";
import { plainTextOfHtml } from "../editing/clipboard";
import { useBlock } from "../hooks";
import { Button } from "../shared/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../shared/ui/DropdownMenu";
import { cn } from "../shared/ui/cn";
import { Ellipsis, EllipsisVertical, Plus } from "../shared/ui/icons";
import { BlockGroups } from "./BlockView";
import { BlockContext, useBlockContextValue } from "./block-context";
import { useFormatPalette } from "./format-palette-context";

const EMPTY_IDS: BlockId[] = [];

// The handle zone: the 20 px band above the table (the column handles) and
// left of the table (the row handles), reserved inside the scroll content
// so the handles stand outside the table's box yet scroll with it (a
// column scrolled out of view takes its handle with it).
const HANDLE_ZONE = 20;
// The handle chip size (px) — the chips center on the column / the row.
const HANDLE_SIZE = 20;
// The add-row / add-column chip size (px) — the row chip's left offset is
// computed against it.
const ADD_BUTTON_SIZE = 24;
// The pointer travel before a handle press becomes a drag (a shorter press
// is a click and opens the handle's menu).
const DRAG_THRESHOLD = 4;

// The add chips stand hidden until the table frame is hovered or holds the
// focus (typing in a cell keeps them up), like the code header's controls.
const ADD_BUTTON_CLASSES =
  "pointer-events-none opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100";

/** The handle chip's classes (revealed when hovered / dragged / menued). */
function handleClasses(visible: boolean, dragging: boolean): string {
  return cn(
    `
      absolute z-10 flex size-5 cursor-grab items-center justify-center rounded-md border border-border bg-muted
      text-foreground shadow-xs transition-opacity
    `,
    dragging && "cursor-grabbing",
    visible ? "opacity-100" : "pointer-events-none opacity-0"
  );
}

/**
 * The drop position (0..stationaryWidths.length) of a dragged column for a
 * pointer x (relative to the table's left edge) among the stationary
 * columns: the first column whose midpoint stands right of the pointer.
 * The stationary widths exclude the dragged column (its preview transform
 * does not shift the others).
 */
function columnDropPosition(stationaryWidths: number[], x: number): number {
  let acc = 0;
  for (let i = 0; i < stationaryWidths.length; i++) {
    const width = stationaryWidths[i]!;
    if (x <= acc + width / 2) return i;
    acc += width;
  }
  return stationaryWidths.length;
}

/**
 * The drop position (0..midpoints.length) of a dragged row for a pointer y
 * (relative to the table's top edge) among the stationary row midpoints
 * (ascending): the count of the midpoints standing above the pointer.
 */
function rowDropPosition(midpoints: number[], y: number): number {
  let position = 0;
  for (const mid of midpoints) {
    if (y > mid) position++;
    else break;
  }
  return position;
}

/** Two equal-length sequences with equal elements at every position. */
function sameSequence(a: readonly (string | number)[], b: readonly (string | number)[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

type HandleKind = "row" | "column";

type HandleAction = "insert-after" | "insert-before" | "move-next" | "move-prev" | "duplicate" | "clear" | "remove";

/**
 * The in-flight handle press: the captured geometry and the doc snapshot
 * (the widths / row ids at the press) the release commit validates against
 * (a concurrent structural change makes the drop stale — the rows resync
 * from the doc and no command issues).
 */
interface TableHandleSession {
  kind: HandleKind;
  index: number;
  rowId: string;
  cols: number;
  widths: number[] | null;
  rowIds: string[];
  startX: number;
  startY: number;
  dragging: boolean;
}

/**
 * The live drag preview (the moved handle's translation) — view state:
 * the doc is untouched until the release commit.
 */
interface TableDragPreview {
  kind: HandleKind;
  index: number;
  dx: number;
  dy: number;
}

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
 * center when part of the table is scrolled out).
 */
function TableBlock({ id, block }: { id: BlockId; block: TableBlockType }) {
  const { doc } = useEditorContext();
  const palette = useFormatPalette();
  const rows = block.children ?? EMPTY_IDS;
  const contextValue = useBlockContextValue(id, rows, "table");
  const widths = Array.from(
    { length: block.attrs.cols },
    (_, index) => block.attrs.columnWidths?.[index] ?? DEFAULT_TABLE_COLUMN_WIDTH
  );
  const tableWidth = widths.reduce((sum, width) => sum + width, 0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [rowButtonLeft, setRowButtonLeft] = useState(0);
  const [hover, setHover] = useState<{ row: number; col: number } | null>(null);
  const [menu, setMenu] = useState<{ kind: HandleKind; index: number } | null>(null);
  const [preview, setPreview] = useState<TableDragPreview | null>(null);
  const [rowMetrics, setRowMetrics] = useState<{ top: number; height: number }[]>([]);
  const sessionRef = useRef<TableHandleSession | null>(null);

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
   * A handle press: starts the session (the native click is suppressed —
   * the click or the drag decides on the release).
   */
  const onHandlePointerDown = (kind: HandleKind, index: number) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || sessionRef.current !== null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    sessionRef.current = {
      kind,
      index,
      rowId: kind === "row" ? (rows[index] ?? "") : "",
      cols: block.attrs.cols,
      widths: block.attrs.columnWidths ?? null,
      rowIds: [...rows],
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
    };
  };

  const onHandlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current;
    if (session === null) return;
    const dx = event.clientX - session.startX;
    const dy = event.clientY - session.startY;
    if (!session.dragging && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
      session.dragging = true;
      setHover(null);
    }
    if (session.dragging) setPreview({ kind: session.kind, index: session.index, dx, dy });
  };

  /**
   * The handle release: a non-drag press opens the handle's menu; a drag
   * commits the move after validating the live doc against the press-time
   * snapshot (a concurrent structural change stands — no command, the rows
   * resync from the doc on the next change).
   */
  const onHandlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session === null) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!session.dragging) {
      setMenu({ kind: session.kind, index: session.index });
      return;
    }
    setPreview(null);
    commitHandleDrag(session, event.clientX, event.clientY);
  };

  const onHandlePointerCancel = () => {
    sessionRef.current = null;
    setPreview(null);
  };

  /** The drag's release commit (the stale-drop guard, then the move command). */
  const commitHandleDrag = (session: TableHandleSession, clientX: number, clientY: number) => {
    const live = doc.getBlock(id);
    if (live === null || live.type !== "table") return;
    const table = tableEl();
    if (table === null) return;
    const rect = table.getBoundingClientRect();
    try {
      if (session.kind === "column") {
        // A concurrent structural change (the cols count or the width
        // sequence) invalidates the drop: the column identity stands on the
        // position + its width, and a peer restructure breaks both.
        const liveWidths = live.attrs.columnWidths ?? null;
        if (live.attrs.cols !== session.cols || !sameSequence(liveWidths ?? [], session.widths ?? [])) return;
        const resolved =
          live.attrs.columnWidths ?? Array.from({ length: live.attrs.cols }, () => DEFAULT_TABLE_COLUMN_WIDTH);
        const stationary = resolved.filter((_, i) => i !== session.index);
        const position = columnDropPosition(stationary, clientX - rect.left);
        const toIndex = position > session.index ? position + 1 : position;
        if (toIndex !== session.index) doc.moveTableColumn(id, session.index, toIndex);
      } else {
        // The row identity is the id: a changed row sequence (a peer
        // insert/remove/move) invalidates the drop.
        const liveRows = doc.getChildren(id);
        if (!sameSequence(liveRows, session.rowIds)) return;
        const midpoints: number[] = [];
        Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody > tr")).forEach((tr, i) => {
          if (i === session.index) return;
          midpoints.push(tr.offsetTop + tr.offsetHeight / 2 - rect.top);
        });
        const position = rowDropPosition(midpoints, clientY - rect.top);
        const toIndex = position > session.index ? position + 1 : position;
        if (toIndex !== session.index) doc.moveTableRow(id, session.rowId, toIndex);
      }
    } catch {
      // A rejected move (the concurrent change won the race between the
      // guard and the command): the doc stands as-is, the rows resync.
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

  const isPreview = (kind: HandleKind, index: number): boolean =>
    preview !== null && preview.kind === kind && preview.index === index;

  // A structural change (a peer insert/remove/move) while a menu is open
  // invalidates its index-based anchor: the menu closes (the chip that stood
  // at the index re-anchored onto a different row/column would act on the
  // wrong target). Local menu actions close the menu through the selection
  // before the doc changes, so this fires on concurrent changes only.
  const structureKey = `${block.attrs.cols}:${rows.join(",")}`;
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

  return (
    <div data-slot="docblocks/table-scroll" className="group relative my-(--docblocks-block-spacing)">
      <div ref={scrollRef} className="scrollbar-thin [scrollbar-color:var(--border)_transparent] overflow-x-auto">
        <div
          className="relative w-max pt-5 pl-5"
          onPointerMove={onContentPointerMove}
          onPointerLeave={() => setHover(null)}
        >
          <table
            data-slot="docblocks/table"
            data-block-type="table"
            data-block-id={id}
            className="relative m-0 table-fixed border-collapse"
            style={{ width: tableWidth }}
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
                    dragOffsetY={isPreview("row", rowIndex) ? preview!.dy : 0}
                    dragColumnIndex={preview !== null && preview.kind === "column" ? preview.index : -1}
                    columnDragDx={preview !== null && preview.kind === "column" ? preview.dx : 0}
                  />
                ))}
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
              onOpenChange={(open) => {
                if (!open) setMenu(null);
              }}
              dragging={isPreview("column", index)}
              dragDx={isPreview("column", index) ? preview!.dx : 0}
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
                onAction={(action) => handleAction("column", index, action)}
                onColor={(color) => handleSetColor("column", index, color)}
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
              onOpenChange={(open) => {
                if (!open) setMenu(null);
              }}
              dragging={isPreview("row", rowIndex)}
              dragDx={0}
              dragDy={isPreview("row", rowIndex) ? preview!.dy : 0}
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
                onAction={(action) => handleAction("row", rowIndex, action)}
                onColor={(color) => handleSetColor("row", rowIndex, color)}
              />
            </HandleMenu>
          ))}
          <Button
            type="button"
            data-slot="docblocks/table-add-column"
            aria-label="Add column"
            variant="ghost"
            size="icon"
            onClick={() => doc.insertTableColumn(id)}
            className={cn(ADD_BUTTON_CLASSES, "absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full")}
            style={{ left: HANDLE_ZONE + tableWidth, top: HANDLE_ZONE + tableHeight / 2 }}
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
        onClick={() => doc.insertTableRow(id)}
        className={cn(ADD_BUTTON_CLASSES, "absolute top-full size-6 -translate-y-1/2 rounded-full")}
        style={{ left: rowButtonLeft }}
      >
        <Plus />
      </Button>
    </div>
  );
}

/**
 * One handle: the chip (the pointer-session element + the menu trigger)
 * and the portaled menu content. The chip stays mounted (and visible)
 * while the menu is open — the trigger anchors the content — even after
 * the hover left the table.
 */
function HandleMenu({
  kind,
  index,
  visible,
  left,
  top,
  open,
  onOpenChange,
  dragging,
  dragDx,
  dragDy,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  children,
}: {
  kind: HandleKind;
  index: number;
  visible: boolean;
  left: number;
  top: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dragging: boolean;
  dragDx: number;
  dragDy: number;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: () => void;
  children: ReactNode;
}) {
  return (
    <DropdownMenu modal={false} open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <div
          data-slot={kind === "column" ? "docblocks/table-col-handle" : "docblocks/table-row-handle"}
          data-index={index}
          className={handleClasses(visible, dragging)}
          style={{ left: left + dragDx, top: top + dragDy }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
          {kind === "column" ? <Ellipsis className="size-3.5" /> : <EllipsisVertical className="size-3.5" />}
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-slot={kind === "column" ? "docblocks/table-col-menu" : "docblocks/table-row-menu"}
        aria-label={kind === "column" ? "Column options" : "Row options"}
        sideOffset={6}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The handle's menu items (in the fixed order: the background palette with
 * the conditional remove, the insert / move / duplicate / clear / delete
 * items; the edge moves are disabled). The background
 * color is read from the store (a primitive selector: the menu re-renders
 * when the row/column's cells gain or lose the color — a cell color change
 * does not touch the table block, so the block's own subscription does not
 * fire). */
function HandleMenuItems({
  tableId,
  kind,
  index,
  palette,
  atStart,
  atEnd,
  onAction,
  onColor,
}: {
  tableId: BlockId;
  kind: HandleKind;
  index: number;
  palette: readonly string[];
  atStart: boolean;
  atEnd: boolean;
  onAction: (action: HandleAction) => void;
  onColor: (color: string | null) => void;
}) {
  const { store } = useEditorContext();
  // The color is stored in the row/column's cell attrs (not the table or the
  // row block): the row scans its own cells, the column scans the column's
  // cell across the rows.
  const color = useStore(store, (state) => {
    const table = state.blocks[tableId];
    if (table === undefined || table.type !== "table") return undefined;
    const rowIds = table.children ?? EMPTY_IDS;
    if (kind === "row") {
      const rowId = rowIds[index];
      const row = rowId === undefined ? undefined : state.blocks[rowId];
      if (row === undefined || row.type !== "table-row") return undefined;
      const rowCells = row.children ?? EMPTY_IDS;
      for (const cellId of rowCells) {
        const cell = state.blocks[cellId];
        if (cell !== undefined && cell.type === "table-cell" && cell.attrs?.rowColor !== undefined) {
          return cell.attrs.rowColor;
        }
      }
      return undefined;
    }
    for (const rowId of rowIds) {
      const row = state.blocks[rowId];
      if (row === undefined || row.type !== "table-row") continue;
      const cells = row.children ?? EMPTY_IDS;
      const cellId = cells[index];
      const cell = cellId === undefined ? undefined : state.blocks[cellId];
      if (cell !== undefined && cell.type === "table-cell" && cell.attrs?.columnColor !== undefined) {
        return cell.attrs.columnColor;
      }
    }
    return undefined;
  });
  const column = kind === "column";
  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <span
            className="size-3.5 shrink-0 rounded-sm border border-border"
            style={{ background: color ?? "transparent" }}
          />
          Background
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="grid w-max grid-cols-3 gap-1 p-2">
          {palette.map((swatch) => (
            <Button
              key={swatch}
              type="button"
              variant="outline"
              size="icon"
              data-slot="docblocks/table-swatch"
              data-color={swatch}
              aria-label={`Background ${swatch}`}
              title={swatch}
              className="size-6"
              style={{ background: swatch }}
              onClick={() => onColor(swatch)}
            />
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {color !== undefined && (
        <DropdownMenuItem data-slot="docblocks/table-remove-color" onSelect={() => onColor(null)}>
          Remove background
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onSelect={() => onAction("insert-after")}>
        {column ? "Insert right" : "Insert below"}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onAction("insert-before")}>
        {column ? "Insert left" : "Insert above"}
      </DropdownMenuItem>
      <DropdownMenuItem disabled={atEnd} onSelect={() => onAction("move-next")}>
        {column ? "Move right" : "Move down"}
      </DropdownMenuItem>
      <DropdownMenuItem disabled={atStart} onSelect={() => onAction("move-prev")}>
        {column ? "Move left" : "Move up"}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onAction("duplicate")}>Duplicate</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onAction("clear")}>Clear content</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onAction("remove")}>Delete</DropdownMenuItem>
    </>
  );
}

/** One row: the cell ids come from the row's own snapshot. */
const TableRow = memo(function TableRow({
  id,
  dragOffsetY,
  dragColumnIndex,
  columnDragDx,
}: {
  id: BlockId;
  dragOffsetY: number;
  dragColumnIndex: number;
  columnDragDx: number;
}) {
  const row = useBlock(id);
  const cells = row !== undefined && row.type === "table-row" ? (row.children ?? EMPTY_IDS) : EMPTY_IDS;
  const contextValue = useBlockContextValue(id, cells, "table-row");
  if (row === undefined || row.type !== "table-row") return null;
  const dragging = dragOffsetY !== 0;
  return (
    <tr
      data-block-id={id}
      style={dragging ? { transform: `translateY(${dragOffsetY}px)`, position: "relative", zIndex: 10 } : undefined}
    >
      <BlockContext.Provider value={contextValue}>
        {cells.map((cellId, cellIndex) => (
          <TableCell key={cellId} id={cellId} dragX={dragColumnIndex === cellIndex ? columnDragDx : 0} />
        ))}
      </BlockContext.Provider>
    </tr>
  );
});

/** One cell: its flat content sequence renders through the flat sequence renderer. */
const TableCell = memo(function TableCell({ id, dragX }: { id: BlockId; dragX: number }) {
  const cell = useBlock(id);
  const children = cell !== undefined && cell.type === "table-cell" ? (cell.children ?? EMPTY_IDS) : EMPTY_IDS;
  const contextValue = useBlockContextValue(id, children, "table-cell");
  if (cell === undefined || cell.type !== "table-cell") return null;
  // The cell background: the column color over the row color (the column
  // wins; removing it reveals the row's color).
  const background = cell.attrs?.columnColor ?? cell.attrs?.rowColor;
  const style: CSSProperties = {
    ...(background !== undefined ? { background } : {}),
    ...(dragX !== 0 ? { transform: `translateX(${dragX}px)`, position: "relative", zIndex: 10 } : {}),
  };
  return (
    <td
      data-slot="docblocks/table-cell"
      data-block-id={id}
      className={`
        border-(length:--docblocks-table-border-width) border-(--docblocks-table-border-color)
        p-(--docblocks-table-cell-padding) align-top
      `}
      style={style}
    >
      <BlockContext.Provider value={contextValue}>
        {children.length === 0 ? <CellActivation cellId={id} /> : <BlockGroups ids={children} />}
      </BlockContext.Provider>
    </td>
  );
});

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

export { TableBlock, columnDropPosition, rowDropPosition };
export type { HandleKind, TableHandleSession, TableDragPreview };
