/**
 * The external-form database grid: the live table view over the bridge
 * (the schema + the rows + the live events). The view settings are the
 * block's attrs (the `filter`, the `columnOrder`, the `hiddenColumns`, the
 * `name` display override) written via `updateBlock` (CRDT data,
 * undo-able); the table data itself is the consumer's database (the
 * bridge is the source of truth). The cell editing commits one
 * `bridge.updateRow` per cell (the optimistic layer + the forward-only
 * undo live in the `useDatabaseTable` provider).
 *
 * The layout is a single CSS grid (the header row and the data rows share
 * the column tracks, so the header and the rows always stand aligned):
 * one `minmax` track per visible column + the row-menu track. The column
 * drag (a press-drag over a header cell, like the table block's column
 * handles) previews the live transform (pure view state) and commits the
 * `columnOrder` attr on the release — one `updateBlock`, one undo step,
 * one wire update; a stale drop (a peer restructured the columns) issues
 * nothing.
 */
import { format, parse } from "date-fns";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, PointerEvent as ReactPointerEvent } from "react";

import type { BlockId, DatabaseBlock as DatabaseBlockType, DatabaseFilterPayload } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import { Badge } from "../shared/ui/Badge";
import { Calendar } from "../shared/ui/Calendar";
import { Card, CardContent } from "../shared/ui/Card";
import { Checkbox } from "../shared/ui/Checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../shared/ui/DropdownMenu";
import { Popover, PopoverContent, PopoverTrigger } from "../shared/ui/Popover";
import { ScrollArea } from "../shared/ui/ScrollArea";
import { Select, SelectContent, SelectItem, SelectTrigger } from "../shared/ui/Select";
import { Separator } from "../shared/ui/Separator";
import { TimeSegments } from "../shared/ui/TimeSegments";
import { cn } from "../shared/ui/cn";
import { Ellipsis, Plus } from "../shared/ui/icons";
import type { BridgeColumn, BridgeColumnAnnotation } from "./bridge";
import { columnAnnotation, parseCellValue } from "./bridge";
import { FilterBuilder, emptyFilter, filterIsComplete } from "./filter-builder";
import { formatNumberValue } from "./number-format";
import type { NumberFormatAttrs } from "./number-format";
import { useDatabaseTable } from "./use-database-table";
import type { DatabaseTableRow } from "./use-database-table";

/** The block's visible columns: the `columnOrder` attr first (the
 *  additive columns not listed keep the schema order), the hidden
 *  columns dropped. */
function visibleColumns(
  columns: BridgeColumn[] | undefined,
  columnOrder?: string[],
  hiddenColumns?: string[]
): BridgeColumn[] {
  const all = columns ?? [];
  const hidden = new Set(hiddenColumns ?? []);
  // The hidden columns stand out of the view entirely (the byId remainder
  // includes only the visible ones).
  const byId = new Map(all.filter((column) => !hidden.has(column.id)).map((column) => [column.id, column]));
  const ordered: BridgeColumn[] = [];
  if (columnOrder !== undefined) {
    for (const id of columnOrder) {
      const column = byId.get(id);
      if (column !== undefined) {
        ordered.push(column);
        byId.delete(id);
      }
    }
  }
  // The remainder (the columns the order does not list, the schema order).
  for (const column of byId.values()) ordered.push(column);
  return ordered;
}

/** The add-column type catalog (the `select` columns are the
 *  consumer-level — they need the options set). The `form` entry stands
 *  the attribute form (the number's display attributes) over the
 *  immediate create. */
const ADD_COLUMN_TYPES: Array<{ type: string; label: string; form?: boolean }> = [
  { type: "text", label: "Text" },
  { type: "number", label: "Number", form: true },
  { type: "boolean", label: "Checkbox" },
  { type: "date", label: "Date" },
  { type: "timestamptz", label: "Date & time" },
  { type: "uuid", label: "UUID" },
  { type: "jsonb", label: "JSON" },
];

/** The number column's create form draft (the column's display
 *  attributes — the column's own data, not the block's view attr). */
interface NumberFormDraft {
  decimals: number;
  thousands: boolean;
  prefix: string;
  suffix: string;
  allowNegative: boolean;
}

const EMPTY_NUMBER_FORM: NumberFormDraft = {
  decimals: 0,
  thousands: false,
  prefix: "",
  suffix: "",
  allowNegative: true,
};

/** The number input's step stand: the explicit `decimals` stands the
 *  `10^-decimals` step; the absent stand follows the integer types only
 *  (the float types stand no step — the 0.5 must be typeable). */
function numberStepFor(column: BridgeColumn): string | undefined {
  if (column.decimals !== undefined) {
    const decimals = Math.max(0, Math.min(10, Math.trunc(Number(column.decimals)) || 0));
    return decimals === 0 ? "1" : String(10 ** -decimals);
  }
  const base = column.type.replace(/\[\]$/, "").trim();
  return base === "integer" || base === "int" || base === "smallint" || base === "bigint" ? "1" : undefined;
}

/** The display's attributes stand: the explicit `decimals` (or the
 *  integer stand) takes the fixed-digit format; the float types without
 *  the explicit digits stand the RAW value (no rounding — the display
 *  must not lose the value's own stand). */
function numberDisplayAttrs(column: BridgeColumn): NumberFormatAttrs {
  const base = column.type.replace(/\[\]$/, "").trim();
  const integerish =
    column.decimals !== undefined ||
    base === "integer" ||
    base === "int" ||
    base === "smallint" ||
    base === "bigint" ||
    base === "number";
  return {
    decimals: integerish ? (column.decimals ?? 0) : null,
    thousands: column.thousands,
    prefix: column.prefix,
    suffix: column.suffix,
  };
}

/** The header cell's column-drag session (the press stands the snapshot;
 *  the release stands the commit). */
interface ColumnDragSession {
  columnId: string;
  index: number;
  startX: number;
  /** The visible column id sequence at the press (the stale-drop guard). */
  ids: string[];
  /** The drag has crossed the threshold (a sub-threshold press is a click). */
  started: boolean;
}

/** The drag's start threshold (px): below it the press is a menu click. */
const DRAG_START_THRESHOLD_PX = 4;
// The boolean's toggle guard: the interactive click's toggle and the
// double press's dblclick stand over one gesture (the browser's
// double-click window), not two toggles.
const CHECKBOX_TOGGLE_GUARD_MS = 600;

// The column widths (px): the fluid track's default (7rem — the grid's
// `minmax(7rem, 1fr)`) and the resize floor (like the table block's seam).
const DEFAULT_DATABASE_COLUMN_WIDTH_PX = 112;
const MIN_DATABASE_COLUMN_WIDTH_PX = 50;

/** The in-flight column-resize press: the column (the one the seam stands
 *  at the right edge of) and the press-time width the delta applies to;
 *  `width` is the live (clamped) width the preview renders and the release
 *  commits. */
interface ColumnResizeSession {
  col: number;
  startX: number;
  startWidth: number;
  width: number;
  visible: string[];
}

function DatabaseGrid({ id, block }: { id: BlockId; block: DatabaseBlockType }) {
  const { doc, databaseBridge } = useEditorContext();
  const tableId = block.attrs.tableId;
  if (tableId === undefined) {
    // The inline form: the built-in placeholder card stands (the caller
    // branches); this is the unreachable guard.
    return null;
  }
  return (
    <GridBody
      id={id}
      doc={doc}
      blockId={id}
      bridge={databaseBridge}
      tableId={tableId}
      name={block.attrs.name}
      filter={block.attrs.filter}
      columnOrder={block.attrs.columnOrder}
      hiddenColumns={block.attrs.hiddenColumns}
      columnWidths={block.attrs.columnWidths}
    />
  );
}

interface GridBodyProps {
  id: BlockId;
  doc: import("docblocks-core").Doc;
  blockId: BlockId;
  bridge: import("./bridge").DatabaseBridge;
  tableId: string;
  name?: string;
  filter?: DatabaseFilterPayload;
  columnOrder?: string[];
  hiddenColumns?: string[];
  columnWidths?: number[];
}

/** The cell's selection/editing key (the row id + the column id). */
const cellKeyOf = (rowId: string, colId: string) => `${rowId}\u0000${colId}`;

function GridBody({
  id,
  doc,
  blockId,
  bridge,
  tableId,
  name,
  filter,
  columnOrder,
  hiddenColumns,
  columnWidths,
}: GridBodyProps) {
  const data = useDatabaseTable(bridge, tableId, filter);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState<DatabaseFilterPayload | null>(filter ?? null);
  const [columnMenu, setColumnMenu] = useState<string | null>(null);
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const [addingColumn, setAddingColumn] = useState(false);
  const [numberFormOpen, setNumberFormOpen] = useState(false);
  const [numberForm, setNumberForm] = useState<NumberFormDraft>(EMPTY_NUMBER_FORM);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  /** The in-flight column drag (pure view state): the column id + the live dx. */
  const [drag, setDrag] = useState<{ id: string; dx: number } | null>(null);
  const dragSession = useRef<ColumnDragSession | null>(null);
  const tableRef = useRef<HTMLDivElement | null>(null);

  const columns = visibleColumns(data.table?.columns, columnOrder, hiddenColumns);

  const updateView = (patch: Record<string, unknown>) => {
    doc.updateBlock(blockId, patch);
  };

  // --- The block's display name (the `name` attr; absent / empty = the
  //     bridge's table name stands).
  const displayName = (name ?? "") !== "" ? (name as string) : (data.table?.name ?? tableId);

  // --- The column drag session (the header cell's press).
  const onColumnPointerDown = (column: BridgeColumn, event: ReactPointerEvent<HTMLDivElement>) => {
    // The menu's own controls (the Ellipsis trigger, the rename input) own
    // their presses: no drag session over them.
    if (event.target instanceof Element && event.target.closest('[data-slot="docblocks/database-column-menu"]')) return;
    const index = columns.findIndex((entry) => entry.id === column.id);
    if (index === -1) return;
    dragSession.current = {
      columnId: column.id,
      index,
      startX: event.clientX,
      ids: columns.map((entry) => entry.id),
      started: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onColumnPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = dragSession.current;
    if (session === null) return;
    const dx = event.clientX - session.startX;
    if (!session.started && Math.abs(dx) < DRAG_START_THRESHOLD_PX) return;
    session.started = true;
    setDrag({ id: session.columnId, dx });
  };

  const onColumnPointerUp = (column: BridgeColumn, event: ReactPointerEvent<HTMLDivElement>) => {
    const session = dragSession.current;
    dragSession.current = null;
    if (session === null) return;
    if (!session.started) {
      // A sub-threshold press: the header click stands the menu.
      setColumnMenu(session.columnId);
      return;
    }
    setDrag(null);
    // The stale-drop guard: the visible column sequence must stand as at
    // the press (a peer added / removed / renamed-structurally a column
    // mid-drag invalidates the drop — no commit, the grid resyncs).
    if (!columns.map((entry) => entry.id).every((value, i) => session.ids[i] === value)) return;
    // The drop position among the stationary columns: the count of their
    // midpoints standing left of the pointer (the dragged column's live
    // position is excluded).
    const table = tableRef.current;
    if (table === null) return;
    const midpoints: number[] = [];
    table.querySelectorAll<HTMLElement>("[data-slot='docblocks/database-header-cell']").forEach((cell) => {
      if (cell.dataset.columnId === session.columnId) return;
      const rect = cell.getBoundingClientRect();
      midpoints.push(rect.left + rect.width / 2);
    });
    midpoints.sort((a, b) => a - b);
    let position = 0;
    for (const mid of midpoints) {
      if (event.clientX > mid) position += 1;
    }
    const toIndex = position > session.index ? position - 1 : position;
    if (toIndex === session.index) return;
    // The commit: the visible order with the dragged column at the drop
    // index (the hidden columns keep the schema tail — the attr lists the
    // visible order only).
    const ids = session.ids.filter((value) => value !== session.columnId);
    ids.splice(toIndex, 0, session.columnId);
    updateView({ columnOrder: ids });
  };

  // --- The column resize session (the header cell's right-edge seam).
  const [resizePreview, setResizePreview] = useState<{ col: number; width: number } | null>(null);
  const resizeSession = useRef<ColumnResizeSession | null>(null);

  /** The seam press: starts the resize session (the native click / the
   *  column-drag gesture is suppressed — the seam's press stands its own
   *  session). */
  const onSeamPointerDown = (col: number) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || resizeSession.current !== null) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const header = event.currentTarget.closest<HTMLElement>("[data-slot='docblocks/database-header-cell']");
    const startWidth =
      header !== null && header.offsetWidth > 0 ? header.offsetWidth : DEFAULT_DATABASE_COLUMN_WIDTH_PX;
    resizeSession.current = {
      col,
      startX: event.clientX,
      startWidth,
      width: startWidth,
      visible: columns.map((entry) => entry.id),
    };
  };

  const onSeamPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = resizeSession.current;
    if (session === null) return;
    session.width = Math.max(
      Math.round(session.startWidth + (event.clientX - session.startX)),
      MIN_DATABASE_COLUMN_WIDTH_PX
    );
    setResizePreview({ col: session.col, width: session.width });
  };

  /** The seam release: the clamped width commits when it changed (one
   *  `updateBlock`, one undo step) — the untouched columns stand their
   *  measured rendered width (the WYSIWYG lock); a 0 px drag stands a
   *  no-op (no wire traffic), and a stale visible sequence (a peer
   *  reordered / hid a column mid-drag) stands no commit. */
  const onSeamPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = resizeSession.current;
    resizeSession.current = null;
    setResizePreview(null);
    if (session === null) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (session.width === session.startWidth) return;
    if (!columns.map((entry) => entry.id).every((value, i) => session.visible[i] === value)) return;
    const cells = Array.from(document.querySelectorAll<HTMLElement>("[data-slot='docblocks/database-header-cell']"));
    const next = columns.map((_, i) => {
      if (i === session.col) return session.width;
      const measured = cells[i]?.offsetWidth ?? 0;
      const set = columnWidths?.[i];
      const stand = set !== undefined && set > 0 ? set : measured > 0 ? measured : DEFAULT_DATABASE_COLUMN_WIDTH_PX;
      return Math.max(Math.round(stand), MIN_DATABASE_COLUMN_WIDTH_PX);
    });
    updateView({ columnWidths: next });
  };

  const onSeamPointerCancel = () => {
    resizeSession.current = null;
    setResizePreview(null);
  };

  // --- The cell selection (pure view state): the single click stands the
  //     one cell, the press-drag stands the rectangle (the region between
  //     the anchor and the hovered cell), the double click stands the edit
  //     session. The frame stands the anchor (the region's fixed corner) +
  //     the cursor (the active cell — the single selection stands anchor
  //     === cursor): the keyboard's arrow stands the region's slide, the
  //     shift+arrow stands the cursor's move over the anchor (the region's
  //     extension). The only data stand is the Delete / Backspace clear
  //     (the batch's one commit, the columns are the null cells — the
  //     boolean null stands the unchecked box).
  const [selectionFrame, setSelectionFrame] = useState<{
    anchorR: number;
    anchorC: number;
    cursorR: number;
    cursorC: number;
  } | null>(null);
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const rows = data.rows;
  // The selection's set (the rectangle over the frame's corners — the
  // cells' keys stand from the live rows / columns by their indices).
  const selectedCells = useMemo(() => {
    const keys = new Set<string>();
    if (selectionFrame === null) return keys;
    const rMin = Math.min(selectionFrame.anchorR, selectionFrame.cursorR);
    const rMax = Math.max(selectionFrame.anchorR, selectionFrame.cursorR);
    const cMin = Math.min(selectionFrame.anchorC, selectionFrame.cursorC);
    const cMax = Math.max(selectionFrame.anchorC, selectionFrame.cursorC);
    for (let ri = rMin; ri <= rMax; ri += 1) {
      for (let ci = cMin; ci <= cMax; ci += 1) {
        const row = rows[ri];
        const column = columns[ci];
        if (row === undefined || column === undefined) continue;
        keys.add(cellKeyOf(row.rowId, column.id));
      }
    }
    return keys;
  }, [selectionFrame, rows, columns]);
  const cellDragRef = useRef<{
    anchorR: number;
    anchorC: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  // The boolean cell's press stand: armed = the cell stood the sole
  // selection at the press (the checkbox's press stands the toggle over
  // it); toggledTs = the interactive click's toggle time (the dblclick
  // over the same gesture stands no second toggle — the pointerdown's
  // detail stands 0, so the gesture's pair is the click's own detail +
  // the toggle's timestamp over the browser's double-click window).
  const booleanPressRef = useRef<{ armed: boolean; toggledTs: number }>({ armed: false, toggledTs: 0 });

  /** The cell press: the selection stand (the single cell at first; the
   *  press-drag extends it to the rectangle). The window-level session (no
   *  pointer capture: the capture would retarget the click / dblclick to
   *  the table and stand the double press's edit entry). The focused
   *  input keeps its own native stand (the text selection inside the input
   *  is never captured). */
  const onCellPointerDown =
    (rowId: string, colId: string, r: number, c: number) => (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      if (event.target instanceof HTMLInputElement) return;
      // The press over the grid's own portaled content (the date / datetime
      // pickers, the select list) is that content's interaction — the
      // portaled nodes are not the cell's DOM descendants, but they stand
      // below the cell in the React tree, so the press would reach here and
      // tear the editing session down (the picker would close itself).
      if (event.target instanceof Element && event.target.closest("[data-radix-popper-content-wrapper]") !== null)
        return;
      const key = cellKeyOf(rowId, colId);
      booleanPressRef.current.armed = selectedCells.size === 1 && selectedCells.has(key);
      cellDragRef.current = { anchorR: r, anchorC: c, startX: event.clientX, startY: event.clientY, moved: false };
      setEditingCell(null);
      setSelectionFrame({ anchorR: r, anchorC: c, cursorR: r, cursorC: c });
      tableRef.current?.focus({ preventScroll: true });
    };

  // The press-drag's region extension (the window's pointer events: the
  // press may leave the table while the drag stands). The handlers read the
  // session from the ref and the region's keys from the DOM (the cells'
  // data-key), so the component-lifetime listeners stand no stale closure.
  useEffect(() => {
    const move = (moveEvent: PointerEvent) => {
      const session = cellDragRef.current;
      if (session === null) return;
      if (!session.moved) {
        if (
          Math.hypot(moveEvent.clientX - session.startX, moveEvent.clientY - session.startY) < DRAG_START_THRESHOLD_PX
        )
          return;
        session.moved = true;
      }
      if (typeof document.elementFromPoint !== "function") return; // the headless DOM
      const el = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
      const cellEl =
        el instanceof Element
          ? el.closest<HTMLElement>("[data-slot='docblocks/database-cell'][data-row][data-col]")
          : null;
      if (cellEl === null) return;
      const row = Number(cellEl.dataset.row);
      const col = Number(cellEl.dataset.col);
      if (!Number.isInteger(row) || !Number.isInteger(col)) return;
      // The region stands the frame's cursor move (the anchor — the
      // press's cell — stands; the selection's set re-derives).
      setSelectionFrame((frame) => (frame === null ? frame : { ...frame, cursorR: row, cursorC: col }));
    };
    const end = () => {
      cellDragRef.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      cellDragRef.current = null;
    };
  }, []);

  /** The selection's clear (the Delete / Backspace over the stand; the
   *  focused input keeps its own character editing — no cell clear). One
   *  `updateRow` per row, the columns are the null cells. */
  const onTableKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      if (selectionFrame === null && editingCell === null) return;
      // The grid owns the Escape (the cell selection / the edit session):
      // the editor root's blocks-selection gesture must not double-fire.
      event.preventDefault();
      event.stopPropagation();
      setSelectionFrame(null);
      setEditingCell(null);
      return;
    }
    // The keyboard's selection stand: the arrow stands the region's slide
    // (the single cell's move; the shape stands, the grid's edge stands no
    // move), the shift+arrow stands the region's extension (the cursor
    // moves over the anchor — the Excel's model).
    const isArrow =
      event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "ArrowLeft" || event.key === "ArrowRight";
    if (isArrow) {
      if (event.target instanceof HTMLInputElement) return; // the input's own stand
      if (selectionFrame === null) return; // the stand stands the selected region only
      event.preventDefault();
      // The arrows over the stand are the grid's own gesture: the editor
      // root's caret navigation must not fire over the table's focus.
      event.stopPropagation();
      const dr = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
      const dc = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
      const rowsCount = rows.length;
      const colsCount = columns.length;
      if (rowsCount === 0 || colsCount === 0) return;
      if (event.shiftKey) {
        setSelectionFrame((frame) =>
          frame === null
            ? frame
            : {
                ...frame,
                cursorR: Math.max(0, Math.min(frame.cursorR + dr, rowsCount - 1)),
                cursorC: Math.max(0, Math.min(frame.cursorC + dc, colsCount - 1)),
              }
        );
        return;
      }
      setSelectionFrame((frame) => {
        if (frame === null) return frame;
        const rMin = Math.min(frame.anchorR, frame.cursorR);
        const rMax = Math.max(frame.anchorR, frame.cursorR);
        const cMin = Math.min(frame.anchorC, frame.cursorC);
        const cMax = Math.max(frame.anchorC, frame.cursorC);
        // The slide's clamp: the region's top / left corner stands over
        // the grid (the edge stands no move — the shift is 0 at the
        // boundary).
        const r0 = Math.max(0, Math.min(rMin + dr, rowsCount - 1 - (rMax - rMin)));
        const c0 = Math.max(0, Math.min(cMin + dc, colsCount - 1 - (cMax - cMin)));
        const rShift = r0 - rMin;
        const cShift = c0 - cMin;
        if (rShift === 0 && cShift === 0) return frame;
        return {
          ...frame,
          anchorR: frame.anchorR + rShift,
          anchorC: frame.anchorC + cShift,
          cursorR: frame.cursorR + rShift,
          cursorC: frame.cursorC + cShift,
        };
      });
      return;
    }
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    if (event.target instanceof HTMLInputElement) return;
    if (selectedCells.size === 0) return;
    event.preventDefault();
    // The cell clear is the grid's own gesture: the editor root's
    // blocks-selection Delete (the non-text row removal) must not fire
    // over the stand (the stand's row would take the block-level delete).
    event.stopPropagation();
    const byRow = new Map<string, Record<string, unknown>>();
    selectedCells.forEach((key) => {
      const [rowId, colId] = key.split("\u0000");
      const cells = byRow.get(rowId!) ?? {};
      cells[colId!] = null;
      byRow.set(rowId!, cells);
    });
    // The whole clear is ONE commit (the batch's one bridge call + the
    // one undo entry): the undo stands every cleared row back, not one
    // per row.
    void data.updateRows([...byRow.entries()].map(([rowId, cells]) => ({ rowId, cells })));
  };

  // A press outside the table stands the selection no stand (the view
  // state resets; the edit session closes with it). The press over the
  // grid's own portaled content (the date / datetime pickers, the select
  // list, the menus) is the grid's own interaction — the portaled nodes
  // are not the table's descendants, so the Radix popper wrapper is the
  // inside test.
  useEffect(() => {
    if (selectionFrame === null) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target !== null && (target as Element).closest?.("[data-radix-popper-content-wrapper]") !== null) return;
      if (tableRef.current === null || !tableRef.current.contains(event.target as Node)) {
        setSelectionFrame(null);
        setEditingCell(null);
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [selectionFrame]);

  if (data.phase === "loading") {
    return (
      <Card data-slot="docblocks/block" data-block-type="database" data-block-id={id}>
        <CardContent data-slot="docblocks/database" data-state="loading" className="p-(--docblocks-block-spacing)">
          <span className="text-(length:--docblocks-font-size) text-(--docblocks-placeholder-color)">
            Loading the table…
          </span>
        </CardContent>
      </Card>
    );
  }

  if (data.phase === "broken" || data.table === null) {
    return (
      <Card
        data-slot="docblocks/block"
        data-block-type="database"
        data-block-id={id}
        className="
          my-(--docblocks-block-spacing) rounded-(--docblocks-radius) border-(length:--docblocks-table-border-width)
          border-(--docblocks-table-border-color) outline-none
        "
      >
        <CardContent
          data-slot="docblocks/database"
          data-state="broken"
          className="flex items-center justify-between gap-(--docblocks-block-spacing) p-(--docblocks-block-spacing)"
        >
          <div className="flex flex-col">
            <span
              data-slot="docblocks/database-broken"
              className="text-(length:--docblocks-font-size) font-(--docblocks-heading-font-weight)"
            >
              Table not found
            </span>
            <span className="text-(length:--docblocks-font-size) text-(--docblocks-placeholder-color)">
              {data.error ?? `The table "${tableId}" is unknown to the bridge.`}
            </span>
          </div>
          <button
            type="button"
            data-slot="docblocks/database-retry"
            className="
              cursor-pointer rounded-(--docblocks-radius) border-(length:--docblocks-table-border-width)
              border-(--docblocks-table-border-color) bg-transparent px-2 py-1 text-(length:--docblocks-font-size)
              outline-none
              hover:opacity-70
            "
            onClick={() => data.retry()}
          >
            Retry
          </button>
        </CardContent>
      </Card>
    );
  }

  const applyFilter = () => {
    updateView({ filter: filterDraft });
    setFilterOpen(false);
  };
  const commitName = (draft: string) => {
    setNameDraft(null);
    const trimmed = draft.trim();
    if (trimmed === (name ?? "")) return;
    updateView({ name: trimmed });
  };

  const lastRowId = rows.length > 0 ? rows[rows.length - 1]!.rowId : null;

  return (
    <Card
      data-slot="docblocks/block"
      data-block-type="database"
      data-block-id={id}
      data-state="ready"
      className="
        my-(--docblocks-block-spacing) rounded-(--docblocks-radius) border-(length:--docblocks-table-border-width)
        border-(--docblocks-table-border-color) outline-none
      "
    >
      <CardContent
        data-slot="docblocks/database"
        className="flex flex-col gap-(--docblocks-block-spacing) p-(--docblocks-block-spacing)"
      >
        <div data-slot="docblocks/database-toolbar" className="flex flex-wrap items-center gap-2">
          {nameDraft !== null ? (
            <input
              data-slot="docblocks/database-name-input"
              className="
                min-w-32 rounded-(--docblocks-radius) border-(length:--docblocks-table-border-width)
                border-(--docblocks-table-border-color) bg-transparent px-1 text-(length:--docblocks-font-size)
                font-(--docblocks-heading-font-weight) outline-none
              "
              value={nameDraft}
              autoFocus
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={(event) => commitName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                if (event.key === "Escape") setNameDraft(null);
              }}
            />
          ) : (
            <button
              type="button"
              data-slot="docblocks/database-name"
              title="Rename"
              className="
                cursor-text rounded-(--docblocks-radius) px-1 text-(length:--docblocks-font-size)
                font-(--docblocks-heading-font-weight) outline-none
                hover:opacity-70
              "
              onClick={() => setNameDraft(displayName)}
            >
              {displayName}
            </button>
          )}
          <Badge data-slot="docblocks/database-count" variant="secondary">
            {rows.length} {rows.length === 1 ? "row" : "rows"}
          </Badge>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              data-slot="docblocks/database-undo"
              data-disabled={data.canUndo ? undefined : true}
              className="
                cursor-pointer rounded-(--docblocks-radius) border-(length:--docblocks-table-border-width)
                border-(--docblocks-table-border-color) bg-transparent px-2 py-0.5 text-xs outline-none
                hover:opacity-70
                disabled:cursor-default disabled:opacity-40
              "
              disabled={!data.canUndo}
              onClick={() => void data.undo()}
            >
              Undo
            </button>
            <button
              type="button"
              data-slot="docblocks/database-redo"
              data-disabled={data.canRedo ? undefined : true}
              className="
                cursor-pointer rounded-(--docblocks-radius) border-(length:--docblocks-table-border-width)
                border-(--docblocks-table-border-color) bg-transparent px-2 py-0.5 text-xs outline-none
                hover:opacity-70
                disabled:cursor-default disabled:opacity-40
              "
              disabled={!data.canRedo}
              onClick={() => void data.redo()}
            >
              Redo
            </button>
            <Popover
              open={filterOpen}
              onOpenChange={(open) => {
                setFilterOpen(open);
                if (open) setFilterDraft(filter ?? null);
              }}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  data-slot="docblocks/database-filter"
                  data-active={filter !== undefined && filter.conditions.length > 0 ? "true" : undefined}
                  className="
                    cursor-pointer rounded-(--docblocks-radius) border-(length:--docblocks-table-border-width)
                    border-(--docblocks-table-border-color) bg-transparent px-2 py-0.5 text-xs outline-none
                    hover:opacity-70
                  "
                >
                  Filter{filter !== undefined && filter.conditions.length > 0 ? " •" : ""}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-96">
                <div className="flex flex-col gap-(--docblocks-block-spacing)">
                  <FilterBuilder value={filterDraft} columns={data.table.columns} onChange={setFilterDraft} />
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      data-slot="docblocks/filter-clear"
                      className="
                        cursor-pointer rounded-md border border-border bg-transparent px-2 py-1 text-xs outline-none
                        hover:opacity-70
                      "
                      onClick={() => setFilterDraft(emptyFilter())}
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      data-slot="docblocks/filter-apply"
                      disabled={!filterIsComplete(filterDraft, data.table.columns)}
                      className="
                        cursor-pointer rounded-md border border-border bg-accent px-2 py-1 text-xs text-foreground
                        outline-none
                        hover:opacity-70
                        disabled:cursor-default disabled:opacity-40
                      "
                      onClick={applyFilter}
                    >
                      Apply
                    </button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <ScrollArea data-slot="docblocks/database-grid">
          <div
            ref={tableRef}
            data-slot="docblocks/database-table"
            tabIndex={0}
            // The grid's pointer model stands the cell / column selection —
            // the native text selection over the drag is suppressed (the
            // editable inputs stand the explicit `select-text`).
            className="grid w-full outline-none select-none"
            onKeyDown={onTableKeyDown}
            style={{
              gridTemplateColumns: `${columns
                .map((_, index) => {
                  const preview =
                    resizePreview !== null && resizePreview.col === index ? resizePreview.width : undefined;
                  const width = preview ?? columnWidths?.[index];
                  return width !== undefined ? `${width}px` : "minmax(7rem, 1fr)";
                })
                .join(" ")} 2.5rem`,
            }}
          >
            {columns.map((column, index) => (
              <HeaderCell
                key={column.id}
                column={column}
                colIndex={index}
                first={index === 0}
                resizing={resizePreview !== null && resizePreview.col === index}
                dragDx={drag !== null && drag.id === column.id ? drag.dx : 0}
                menuOpen={columnMenu === column.id}
                onMenuChange={(open) => setColumnMenu(open ? column.id : null)}
                onRename={(renameName) => void data.renameColumn(column.id, renameName)}
                onHide={() => updateView({ hiddenColumns: [...(hiddenColumns ?? []), column.id] })}
                onShow={() =>
                  updateView({ hiddenColumns: (hiddenColumns ?? []).filter((entryId) => entryId !== column.id) })
                }
                onDelete={() => void data.deleteColumn(column.id)}
                hidden={(hiddenColumns ?? []).includes(column.id)}
                onPointerDown={(event) => onColumnPointerDown(column, event)}
                onResizePointerDown={(event) => onSeamPointerDown(index)(event)}
                onResizePointerMove={onSeamPointerMove}
                onResizePointerUp={onSeamPointerUp}
                onResizePointerCancel={onSeamPointerCancel}
                onPointerMove={onColumnPointerMove}
                onPointerUp={(event) => onColumnPointerUp(column, event)}
              />
            ))}
            <div
              data-slot="docblocks/database-add-column"
              className="
                relative flex items-center justify-center border-b-(length:--docblocks-table-border-width)
                border-(--docblocks-table-border-color)
              "
            >
              <DropdownMenu modal={false} open={addingColumn} onOpenChange={setAddingColumn}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    data-slot="docblocks/database-add-column-trigger"
                    className="
                      cursor-pointer rounded-(--docblocks-radius) p-1 text-(--docblocks-placeholder-color) outline-none
                      hover:text-(--docblocks-text-color)
                    "
                  >
                    <Plus className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-32">
                  {ADD_COLUMN_TYPES.map((entry) => (
                    <DropdownMenuItem
                      key={entry.type}
                      data-column-type={entry.type}
                      onClick={() => {
                        if (entry.form) {
                          setNumberForm(EMPTY_NUMBER_FORM);
                          setAddingColumn(false);
                          setNumberFormOpen(true);
                          return;
                        }
                        const columnSuffix = String((data.table?.columns.length ?? 0) + 1);
                        void data.addColumn({ id: `col${columnSuffix}`, name: entry.label, type: entry.type });
                      }}
                    >
                      {entry.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {/* The number's attribute form (the menu's Number entry opens it): the
                  column's display attributes stand the bridge's column data. */}
              <Popover open={numberFormOpen} onOpenChange={setNumberFormOpen}>
                <PopoverTrigger asChild>
                  <span data-slot="docblocks/database-add-column-form-anchor" className="absolute size-0" />
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-60 p-3"
                  // The menu's Number entry stands the form: the menu's
                  // close restores the focus to the plus trigger (outside
                  // the popover content) — the focus-outside would close
                  // the form the very tick it opens. The outside press
                  // (the interact-outside) and the Escape keep the close.
                  onFocusOutside={(event) => event.preventDefault()}
                >
                  <div data-slot="docblocks/database-add-column-form" className="flex flex-col gap-2">
                    <label className="flex items-center gap-2 text-xs text-foreground">
                      Decimals
                      <input
                        type="number"
                        min={0}
                        max={10}
                        data-slot="docblocks/database-add-column-decimals"
                        className="
                          w-16 cursor-text rounded-md border border-border bg-transparent px-1 py-0.5 text-xs
                          outline-none
                          focus:bg-muted/60
                        "
                        value={numberForm.decimals}
                        onChange={(event) =>
                          setNumberForm({ ...numberForm, decimals: Number(event.target.value) || 0 })
                        }
                      />
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
                      <Checkbox
                        data-slot="docblocks/database-add-column-thousands"
                        checked={numberForm.thousands}
                        onCheckedChange={(checked) => setNumberForm({ ...numberForm, thousands: checked === true })}
                      />
                      Thousands' separator
                    </label>
                    <label className="flex items-center gap-2 text-xs text-foreground">
                      Prefix
                      <input
                        type="text"
                        data-slot="docblocks/database-add-column-prefix"
                        className="
                          w-full cursor-text rounded-md border border-border bg-transparent px-2 py-0.5 text-xs
                          outline-none
                          focus:bg-muted/60
                        "
                        value={numberForm.prefix}
                        onChange={(event) => setNumberForm({ ...numberForm, prefix: event.target.value })}
                      />
                    </label>
                    <label className="flex items-center gap-2 text-xs text-foreground">
                      Suffix
                      <input
                        type="text"
                        data-slot="docblocks/database-add-column-suffix"
                        className="
                          w-full cursor-text rounded-md border border-border bg-transparent px-2 py-0.5 text-xs
                          outline-none
                          focus:bg-muted/60
                        "
                        value={numberForm.suffix}
                        onChange={(event) => setNumberForm({ ...numberForm, suffix: event.target.value })}
                      />
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
                      <Checkbox
                        data-slot="docblocks/database-add-column-negative"
                        checked={numberForm.allowNegative}
                        onCheckedChange={(checked) => setNumberForm({ ...numberForm, allowNegative: checked === true })}
                      />
                      Allow negative
                    </label>
                    <button
                      type="button"
                      data-slot="docblocks/database-add-column-create"
                      className="
                        cursor-pointer rounded-md border border-border bg-accent px-2 py-1 text-xs text-foreground
                        outline-none
                        hover:opacity-70
                      "
                      onClick={() => {
                        const columnSuffix = String((data.table?.columns.length ?? 0) + 1);
                        void data.addColumn({
                          id: `col${columnSuffix}`,
                          name: "Number",
                          type: "number",
                          decimals: numberForm.decimals,
                          thousands: numberForm.thousands,
                          prefix: numberForm.prefix === "" ? undefined : numberForm.prefix,
                          suffix: numberForm.suffix === "" ? undefined : numberForm.suffix,
                          allowNegative: numberForm.allowNegative,
                        });
                        setNumberFormOpen(false);
                      }}
                    >
                      Add column
                    </button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            {rows.map((row, rowIndex) => (
              <Fragment key={row.rowId}>
                {columns.map((column, index) => {
                  const key = cellKeyOf(row.rowId, column.id);
                  return (
                    <DatabaseCell
                      key={column.id}
                      rowId={row.rowId}
                      column={column}
                      value={row.cells[column.id]}
                      rowIndex={rowIndex}
                      colIndex={index}
                      first={index === 0}
                      lastRow={row.rowId === lastRowId}
                      dragDx={drag !== null && drag.id === column.id ? drag.dx : 0}
                      selected={selectedCells.has(key)}
                      singleSelected={selectedCells.has(key) && selectedCells.size === 1}
                      editing={editingCell === key}
                      onChange={(value) => void data.updateRow(row.rowId, { [column.id]: value })}
                      onPointerDown={onCellPointerDown(row.rowId, column.id, rowIndex, index)}
                      onEditStart={() => setEditingCell(key)}
                      onEditEnd={() => setEditingCell(null)}
                      booleanPress={booleanPressRef}
                    />
                  );
                })}
                <RowMenuCell
                  row={row}
                  rowMenu={rowMenu}
                  setRowMenu={setRowMenu}
                  canMoveUp={rows.indexOf(row) > 0}
                  canMoveDown={rows.indexOf(row) < rows.length - 1}
                  onMoveUp={() => {
                    const index = rows.indexOf(row);
                    if (index > 0) void data.moveRow(row.rowId, rows[index - 1]!.rowId);
                  }}
                  onMoveDown={() => {
                    const index = rows.indexOf(row);
                    if (index < rows.length - 1)
                      void data.moveRow(row.rowId, index + 2 < rows.length ? rows[index + 2]!.rowId : null);
                  }}
                  onRemove={() => void data.removeRow(row.rowId)}
                  lastRow={row.rowId === lastRowId}
                />
              </Fragment>
            ))}
          </div>

          {rows.length === 0 && (
            <div
              data-slot="docblocks/database-empty"
              className="
                px-(--docblocks-table-cell-padding) py-(--docblocks-block-spacing) text-(length:--docblocks-font-size)
                text-(--docblocks-placeholder-color)
              "
            >
              No rows{filter !== undefined ? " match the filter" : ""}.
            </div>
          )}
        </ScrollArea>

        <button
          type="button"
          data-slot="docblocks/database-add-row"
          className="
            cursor-pointer self-start rounded-(--docblocks-radius) border-(length:--docblocks-table-border-width)
            border-(--docblocks-table-border-color) bg-transparent px-2 py-1 text-(length:--docblocks-font-size)
            text-(--docblocks-placeholder-color) outline-none
            hover:text-(--docblocks-text-color)
          "
          onClick={() => void data.insertRow({})}
        >
          + Add row
        </button>
      </CardContent>
    </Card>
  );
}

interface HeaderCellProps {
  column: BridgeColumn;
  colIndex: number;
  first: boolean;
  resizing: boolean;
  dragDx: number;
  menuOpen: boolean;
  onMenuChange: (open: boolean) => void;
  onRename: (name: string) => void;
  onHide: () => void;
  onShow: () => void;
  onDelete: () => void;
  hidden: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizePointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizePointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizePointerCancel: () => void;
}

/** The header cell (the column's name; the press stands the menu, the
 *  press-drag stands the column drag). The right-edge seam resizes the
 *  column (the table block's seam idiom: the 6 px strip, the 50 px floor,
 *  the live preview, the one `updateBlock` on the release). The menu
 *  content: the editable name line (the rename commits on the blur / the
 *  Enter), the type line (read-only), and the show / hide / delete items. */
function HeaderCell({
  column,
  colIndex,
  first,
  resizing,
  dragDx,
  menuOpen,
  onMenuChange,
  onRename,
  onHide,
  onShow,
  onDelete,
  hidden,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onResizePointerDown,
  onResizePointerMove,
  onResizePointerUp,
  onResizePointerCancel,
}: HeaderCellProps) {
  const [nameDraft, setNameDraft] = useState(column.name);
  const commitRename = () => {
    const trimmed = nameDraft.trim();
    if (trimmed !== "" && trimmed !== column.name) onRename(trimmed);
    setNameDraft(column.name);
  };
  return (
    <div
      data-slot="docblocks/database-header-cell"
      data-column-id={column.id}
      style={dragDx !== 0 ? { transform: `translateX(${dragDx}px)`, position: "relative", zIndex: 10 } : undefined}
      className={cn(
        `
          relative flex min-w-0 cursor-grab items-center gap-1 border-b-(length:--docblocks-table-border-width)
          border-(--docblocks-table-border-color) bg-muted/40 px-(--docblocks-table-cell-padding) py-1 select-none
          active:cursor-grabbing
        `,
        !first && "border-l-(length:--docblocks-table-border-width)"
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <span className="min-w-0 truncate text-(length:--docblocks-font-size) font-(--docblocks-heading-font-weight)">
        {column.name}
      </span>
      <div className="ml-auto shrink-0">
        <DropdownMenu modal={false} open={menuOpen} onOpenChange={onMenuChange}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-slot="docblocks/database-column-menu"
              className="
                cursor-pointer rounded-(--docblocks-radius) p-0.5 text-(--docblocks-placeholder-color) outline-none
                hover:text-(--docblocks-text-color)
              "
            >
              <Ellipsis className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={4} className="flex w-52 flex-col gap-2 p-2">
            <div className="flex flex-col gap-1">
              <input
                data-slot="docblocks/database-rename-input"
                className="
                  w-full rounded-md border-0 bg-muted/60 px-2 py-1 text-sm text-foreground outline-none select-text
                  focus:bg-muted
                "
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                onFocus={() => setNameDraft(column.name)}
                onBlur={commitRename}
                onKeyDown={(event) => {
                  if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                  if (event.key === "Escape") {
                    setNameDraft(column.name);
                    onMenuChange(false);
                  }
                }}
              />
              <span data-slot="docblocks/database-column-type" className="px-1.5 text-xs text-muted-foreground">
                {column.type}
              </span>
            </div>
            <Separator />
            <DropdownMenuItem onClick={hidden ? onShow : onHide}>
              {hidden ? "Show column" : "Hide column"}
            </DropdownMenuItem>
            <DropdownMenuItem
              data-destructive
              onClick={() => {
                onMenuChange(false);
                onDelete();
              }}
            >
              Delete column
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div
        data-slot="docblocks/database-col-resize"
        data-index={colIndex}
        className={cn(
          `absolute top-0 -right-1.5 z-10 h-full w-1.5 cursor-col-resize opacity-0 transition-opacity hover:opacity-100`,
          resizing && "opacity-100"
        )}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onPointerCancel={onResizePointerCancel}
      >
        <div data-slot="docblocks/database-col-resize-line" className="h-full w-0.5 rounded bg-(--muted-foreground)" />
      </div>
    </div>
  );
}

/** The empty cell's option value (the radix Select rejects the empty
 *  string; the sentinel stands the "no value" pick and commits null). */
const EMPTY_CELL_OPTION = "docblocks/empty-cell";

interface RowMenuCellProps {
  row: DatabaseTableRow;
  rowMenu: string | null;
  setRowMenu: (value: string | null) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  lastRow: boolean;
}

/** The row's menu track (the trailing grid column). */
function RowMenuCell({
  row,
  rowMenu,
  setRowMenu,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onRemove,
  lastRow,
}: RowMenuCellProps) {
  return (
    <div
      data-slot="docblocks/database-row-menu"
      className={cn(
        `
          flex w-10 items-center justify-center border-l-(length:--docblocks-table-border-width)
          border-(--docblocks-table-border-color)
        `,
        !lastRow && "border-b-(length:--docblocks-table-border-width)"
      )}
    >
      <DropdownMenu
        modal={false}
        open={rowMenu === row.rowId}
        onOpenChange={(open) => setRowMenu(open ? row.rowId : null)}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-slot="docblocks/database-row-menu-trigger"
            className="
              cursor-pointer rounded-(--docblocks-radius) p-0.5 text-(--docblocks-placeholder-color) outline-none
              hover:text-(--docblocks-text-color)
            "
          >
            <Ellipsis className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-32">
          <DropdownMenuItem disabled={!canMoveUp} onClick={onMoveUp}>
            Move up
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!canMoveDown} onClick={onMoveDown}>
            Move down
          </DropdownMenuItem>
          <DropdownMenuItem data-destructive onClick={onRemove}>
            Delete row
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** The shared cell wrapper classes (the left border + the padding). */
const CELL_WRAP =
  "flex min-h-6 min-w-0 items-center overflow-hidden border-(--docblocks-table-border-color) p-(--docblocks-table-cell-padding)";

/** The selected cell's stand (the shared canvas selection token: the
 *  theme's selection tint + the thin cyan outline over it — the figure
 *  outline's stand). */
/** The cell's selection stand (the sole selection): the canvas figure's
 *  outline tokens over the selection tint. The offset is the negative
 *  (the inset frame): the leftmost column's / rightmost column's / last
 *  row's cell stands the four sides — the outset frame over the scroll
 *  container's content edge stands clipped (the table's w-full grid
 *  stands no padding over the scroller). */
const CELL_SELECTED =
  "bg-(--docblocks-selected-background) outline-(length:--docblocks-canvas-selection-border-width) outline-offset-[-1px] outline-(color:--docblocks-canvas-selection-border-color) outline-solid";

/** The multi-selection's cell stand: the fill only (the outline stands
 *  the sole selection — a multi-region stands the frame on no cell). The
 *  canvas selection's fill (the border token at 50% — the figure
 *  selection's transparency). */
const CELL_SELECTED_MULTI = "bg-(--docblocks-canvas-selection-fill)";

/** The input's shared classes: no own border (the cell's border stands —
 *  the double border is gone), the focus stands the background tint. The
 *  table's `select-none` stands the edit's own text selection (the mouse
 *  selection inside the input is the edit's stand). */
const CELL_INPUT =
  "w-full select-text rounded-(--docblocks-radius) border-0 bg-transparent px-1 text-(length:--docblocks-font-size) outline-none focus:bg-(--docblocks-selected-background)/50";

/** The cell's edit input (the text / the number): the draft stands local,
 *  the commit stands on the blur / the Enter (one `updateRow`); an invalid
 *  number reverts to the last valid value (no commit) + shows
 *  `data-invalid`. The focus stands on the mount (the double-click
 *  session). */
interface CellEditInputProps {
  value: unknown;
  kind: "text" | "number";
  /** The number input's minimum (the non-negative column stands 0). */
  min?: number;
  /** The number input's step stand (the column's decimals). */
  step?: string;
  /** The negative values' reject (the column's `allowNegative` is false): the commit reverts. */
  rejectNegative?: boolean;
  onCommit: (value: unknown) => void;
  onEditEnd: () => void;
}

function CellEditInput({ value, kind, min, step, rejectNegative, onCommit, onEditEnd }: CellEditInputProps) {
  const text = value === undefined || value === null ? "" : String(value);
  const [draft, setDraft] = useState(text);
  const [invalid, setInvalid] = useState(false);
  // The Escape's cancel: the draft reverts to the value and the session
  // closes without a commit (no write over the wire).
  const cancelRef = useRef(false);
  return (
    <input
      type={kind === "number" ? "number" : "text"}
      data-slot="docblocks/database-cell-input"
      data-invalid={invalid ? "true" : undefined}
      autoFocus
      min={min}
      step={step}
      className={CELL_INPUT}
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
        setInvalid(false);
      }}
      onBlur={() => {
        if (cancelRef.current) {
          cancelRef.current = false;
          setDraft(text);
          setInvalid(false);
          onEditEnd();
          return;
        }
        const result = parseCellValue(kind, draft);
        // The negative's reject (the column's `allowNegative` is false):
        // the value parses, but the column does not take it — the input
        // reverts as an invalid stand (no commit).
        const rejected =
          result.ok &&
          rejectNegative === true &&
          kind === "number" &&
          result.value !== null &&
          Number(result.value) < 0;
        if (result.ok && !rejected) {
          setInvalid(false);
          onCommit(result.value);
        } else {
          setInvalid(true);
          setDraft(text);
        }
        onEditEnd();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
        if (event.key === "Escape") {
          cancelRef.current = true;
          (event.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

/** The cell's read-only display (the single-press stand): the value text
 *  or the empty stand (the content-less cell is empty — no placeholder, no
 *  trigger chrome). */
function CellDisplay({
  text,
  ...props
}: { text: string } & React.ComponentPropsWithoutRef<"span"> & { ref?: React.Ref<HTMLSpanElement> }) {
  return (
    <span
      data-slot="docblocks/database-cell-display"
      className="block w-full px-1 text-(length:--docblocks-font-size)"
      {...props}
    >
      {text === "" ? null : text}
    </span>
  );
}

/** The local-calendar day (the year / month / date stand, the time is
 *  dropped) — the picker's draft stand. */
function dateOnly(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

/** The time stand (the hours / minutes / the seconds are not all zero). */
function hasTime(value: Date): boolean {
  return value.getHours() !== 0 || value.getMinutes() !== 0 || value.getSeconds() !== 0;
}

/** The datetime cell's value (the optional "THH:MM" / "THH:MM:SS" time
 *  part) parsed to the local-calendar Date; null when absent / invalid. */
function parseCellDateTime(value: unknown): Date | null {
  const raw = value === undefined || value === null ? "" : String(value);
  if (raw === "") return null;
  if (raw.includes("T")) {
    const withSeconds = parse(raw, "yyyy-MM-dd'T'HH:mm:ss", new Date());
    const result = Number.isNaN(withSeconds.getTime()) ? parse(raw, "yyyy-MM-dd'T'HH:mm", new Date()) : withSeconds;
    return Number.isNaN(result.getTime()) ? null : result;
  }
  const dateOnlyResult = parse(raw, "yyyy-MM-dd", new Date());
  return Number.isNaN(dateOnlyResult.getTime()) ? null : dateOnlyResult;
}

/** The datetime's compact label (`dd.MM.yyyy HH:mm` — the seconds stand
 *  only when they are not zero; the midnight zero stands the date only). */
function dateTimeLabel(value: Date): string {
  const base = format(value, "dd.MM.yyyy");
  if (!hasTime(value)) return base;
  const label = format(value, "HH:mm");
  return value.getSeconds() !== 0 ? `${base} ${label}:${format(value, "ss")}` : `${base} ${label}`;
}

interface DatabaseCellProps {
  rowId: string;
  column: BridgeColumn;
  value: unknown;
  rowIndex: number;
  colIndex: number;
  first: boolean;
  lastRow: boolean;
  dragDx: number;
  selected: boolean;
  /** The cell stands the sole selection (the boolean's checkbox interactive stand). */
  singleSelected: boolean;
  editing: boolean;
  onChange: (value: unknown) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onEditStart: () => void;
  onEditEnd: () => void;
  /** The boolean's press stand (the grid's ref: the toggle's guards). */
  booleanPress: { current: { armed: boolean; toggledTs: number } };
}

/**
 * The cell (the column annotation's editor). The interaction stand
 * (the single press is the selection — the grid extends it to the
 * rectangle; the double press is the edit — the input's focus for the
 * text / number, the toggle for the boolean, the picker's open for the
 * date / datetime / select). The content-less cell stands empty (no
 * placeholder, no trigger chrome): the pickers open on the double press
 * over the cell itself.
 */
function DatabaseCell({
  rowId,
  column,
  value,
  rowIndex,
  colIndex,
  first,
  lastRow,
  dragDx,
  selected,
  singleSelected,
  editing,
  onChange,
  onPointerDown,
  onEditStart,
  onEditEnd,
  booleanPress,
}: DatabaseCellProps) {
  const annotation: BridgeColumnAnnotation = columnAnnotation(column);
  const empty = value === undefined || value === null || value === "";
  const isDate = annotation.valueInput === "date";
  const isDateTime = annotation.valueInput === "datetime";
  const dateValue = isDate || isDateTime ? parseCellDateTime(value) : null;
  const rawValue = value === undefined || value === null ? "" : String(value);
  const dragStyle =
    dragDx !== 0 ? { transform: `translateX(${dragDx}px)`, position: "relative" as const, zIndex: 10 } : undefined;
  // The datetime's drafts stand from the value on the open (the close
  // commits; the in-flight draft never touches the consumer state).
  const [draftDate, setDraftDate] = useState<Date | null>(null);
  const [draftTime, setDraftTime] = useState<string | null>(null);
  useEffect(() => {
    if (!editing || !isDateTime) return;
    setDraftDate(dateValue !== null ? dateOnly(dateValue) : null);
    setDraftTime(dateValue !== null && hasTime(dateValue) ? format(dateValue, "HH:mm:ss") : null);
  }, [editing, isDateTime, rawValue]);

  const commitDateTime = () => {
    const committed = draftDate === null ? null : dateOnly(draftDate);
    if (draftTime !== null && committed !== null) {
      const [hours, minutes, seconds] = draftTime.split(":");
      committed.setHours(Number(hours), Number(minutes), Number(seconds));
    }
    // A no-op close (the draft stands the value) stands no commit.
    if ((committed?.getTime() ?? null) === (dateValue?.getTime() ?? null)) return;
    if (committed === null) {
      onChange(null);
      return;
    }
    const base = format(committed, "yyyy-MM-dd");
    if (!hasTime(committed)) {
      onChange(base);
      return;
    }
    const time = format(committed, "HH:mm");
    onChange(committed.getSeconds() !== 0 ? `${base}T${time}:${format(committed, "ss")}` : `${base}T${time}`);
  };

  let content: ReactNode;
  if (Array.isArray(value)) {
    content = <CellDisplay text={value.join(", ")} />;
  } else {
    switch (annotation.valueInput) {
      case "number": {
        // The display stands the column's format (the prefix / the
        // thousands / the suffix frame the value — the raw number stays
        // the data; a non-numeric stand (the consumer's odd value) keeps
        // the raw string).
        const numeric = rawValue === "" ? null : Number(rawValue);
        const display =
          numeric !== null && Number.isFinite(numeric)
            ? formatNumberValue(numeric, numberDisplayAttrs(column))
            : rawValue;
        content = editing ? (
          <CellEditInput
            value={value}
            kind="number"
            min={column.allowNegative === false ? 0 : undefined}
            step={numberStepFor(column)}
            rejectNegative={column.allowNegative === false}
            onCommit={onChange}
            onEditEnd={onEditEnd}
          />
        ) : (
          <CellDisplay text={empty ? "" : display} />
        );
        break;
      }
      case "date":
        content = (
          <Popover
            open={editing}
            onOpenChange={(open) => {
              if (!open) onEditEnd();
            }}
          >
            <PopoverTrigger asChild>
              <CellDisplay text={dateValue !== null ? format(dateValue, "dd.MM.yyyy") : ""} />
            </PopoverTrigger>
            <PopoverContent align="start" sideOffset={4} className="w-auto p-0">
              <Calendar
                mode="single"
                selected={dateValue ?? undefined}
                {...(dateValue !== null ? { defaultMonth: dateValue } : {})}
                onSelect={(day) => {
                  // The pick commits the ISO date (the same-day pick clears
                  // it — the day-picker's toggle) + closes the popover.
                  const next = day === undefined || day === null ? null : dateOnly(day);
                  onChange(next === null ? null : format(next, "yyyy-MM-dd"));
                  onEditEnd();
                }}
              />
            </PopoverContent>
          </Popover>
        );
        break;
      case "datetime":
        content = (
          <Popover
            open={editing}
            onOpenChange={(open) => {
              if (!open) {
                commitDateTime();
                onEditEnd();
              }
            }}
          >
            <PopoverTrigger asChild>
              <CellDisplay text={dateValue !== null ? dateTimeLabel(dateValue) : ""} />
            </PopoverTrigger>
            <PopoverContent align="start" sideOffset={4} className="w-auto p-0">
              <Calendar
                mode="single"
                selected={draftDate ?? undefined}
                defaultMonth={dateValue ?? undefined}
                onSelect={(day) => setDraftDate(day === undefined || day === null ? null : dateOnly(day))}
              />
              <Separator />
              <div className="p-2">
                <TimeSegments
                  id={`db-cell-time-${rowId}-${column.id}`}
                  value={draftTime}
                  onChange={setDraftTime}
                  clearable
                />
              </div>
            </PopoverContent>
          </Popover>
        );
        break;
      case "boolean": {
        // The checkbox's interactive stand: over the sole selection the
        // press over the checkbox is the toggle (the pointer cursor);
        // otherwise it stands pointer-transparent (the single press is the
        // cell selection, the double press is the toggle over the wrapper).
        const checkboxInteractive = singleSelected && !editing;
        content = (
          <span
            data-slot="docblocks/database-cell-checkbox-wrap"
            className={cn(
              "flex w-full items-center px-1",
              checkboxInteractive ? "cursor-pointer" : "pointer-events-none"
            )}
            onClick={(event) => {
              // The press stands the toggle only over the armed stand
              // (the cell stood the sole selection at the press — the
              // selecting press stands no toggle; the double press's
              // second click is the detail guard). The toggle's
              // timestamp arms the wrapper's dblclick guard.
              if (event.detail > 1) return;
              if (!booleanPress.current.armed) return;
              booleanPress.current.toggledTs = Date.now();
              onChange(value === true ? false : true);
            }}
          >
            <Checkbox
              data-slot="docblocks/database-cell-checkbox"
              aria-label={column.name}
              checked={value === true}
              onCheckedChange={() => undefined}
              className="pointer-events-none"
            />
          </span>
        );
        break;
      }
      case "select":
        content = (
          <Select
            value={value === undefined || value === null ? EMPTY_CELL_OPTION : String(value)}
            onValueChange={(next) => onChange(next === EMPTY_CELL_OPTION ? null : next)}
            open={editing}
            onOpenChange={(open) => {
              if (!open) onEditEnd();
            }}
          >
            <SelectTrigger
              size="sm"
              bare
              className="
                h-full w-full cursor-default justify-start rounded-(--docblocks-radius) border-0 bg-transparent px-1
                text-(length:--docblocks-font-size) shadow-none outline-none
              "
            >
              <span className="line-clamp-1">{empty ? "" : String(value)}</span>
            </SelectTrigger>
            <SelectContent align="start" sideOffset={4}>
              <SelectItem value={EMPTY_CELL_OPTION}>—</SelectItem>
              {(column.options ?? []).map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
        break;
      default:
        content = editing ? (
          <CellEditInput value={value} kind="text" onCommit={onChange} onEditEnd={onEditEnd} />
        ) : (
          <CellDisplay text={empty ? "" : String(value)} />
        );
    }
  }

  return (
    <div
      data-slot="docblocks/database-cell"
      data-key={cellKeyOf(rowId, column.id)}
      data-row={rowIndex}
      data-col={colIndex}
      data-column-id={column.id}
      data-kind={annotation.valueInput}
      data-empty={empty ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
      data-editing={editing ? "true" : undefined}
      className={cn(
        CELL_WRAP,
        !first && "border-l-(length:--docblocks-table-border-width)",
        !lastRow && "border-b-(length:--docblocks-table-border-width)",
        selected && (singleSelected ? CELL_SELECTED : CELL_SELECTED_MULTI)
      )}
      style={dragStyle}
      onPointerDown={onPointerDown}
      onDoubleClick={() => {
        if (annotation.valueInput === "boolean") {
          // The interactive click's toggle already stands over the double
          // press (over the browser's double-click window) — the dblclick
          // stands no second toggle.
          if (Date.now() - booleanPress.current.toggledTs < CHECKBOX_TOGGLE_GUARD_MS) return;
          onChange(value === true ? false : true);
          return;
        }
        onEditStart();
      }}
    >
      {content}
    </div>
  );
}

export { DatabaseGrid, visibleColumns };
