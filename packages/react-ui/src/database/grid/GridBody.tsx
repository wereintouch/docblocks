/** The grid's body: the toolbar (the display name, the count, the
 * undo/redo, the filter popover), the column tracks (the header cells,
 * the add-column chip + the create form (the name input + the
 * type-specific attributes)), the data rows and the cell selection / the
 * column drag / the column resize sessions. */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

import type { BlockId, DatabaseFilterPayload } from "docblocks-core";

import { Badge } from "../../shared/ui/Badge";
import { Card, CardContent } from "../../shared/ui/Card";
import { Checkbox } from "../../shared/ui/Checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../shared/ui/DropdownMenu";
import { Popover, PopoverContent, PopoverTrigger } from "../../shared/ui/Popover";
import { ScrollArea } from "../../shared/ui/ScrollArea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../shared/ui/Select";
import { Plus } from "../../shared/ui/icons";
import type { BridgeColumn } from "../bridge";
import { ENUM_OPTION_COLOR_COLUMN, ENUM_OPTION_NAME_COLUMN } from "../bridge";
import { FilterBuilder, emptyFilter, filterIsComplete } from "../filter-builder";
import { useDatabaseTable } from "../use-database-table";
import { HeaderCell } from "./HeaderCell";
import { DatabaseCell, RowMenuCell } from "./cells";
import { columnTypeIcon } from "./column-type-icon";
import {
  ADD_COLUMN_TYPES,
  DEFAULT_DATABASE_COLUMN_WIDTH_PX,
  DRAG_START_THRESHOLD_PX,
  MIN_DATABASE_COLUMN_WIDTH_PX,
  NEW_TABLE_PICK,
  REF_NONE_PICK,
} from "./constants";
import { EnumOptionsEditor } from "./enum-options-editor";
import { useEnumOptionsMotion } from "./enum-options-motion";
import type { AddColumnFormDraft, ColumnDragSession, ColumnResizeSession } from "./models";
import { useBridgeTables } from "./use-bridge-tables";
import { refEntryKey, useRefTables } from "./use-ref-tables";
import type { RefTableEntry } from "./use-ref-tables";
import { emptyColumnForm } from "./utils";
import { cellKeyOf, visibleColumns } from "./utils";

interface GridBodyProps {
  id: BlockId;
  doc: import("docblocks-core").Doc;
  blockId: BlockId;
  bridge: import("../bridge").DatabaseBridge;
  tableId: string;
  filter?: DatabaseFilterPayload;
  columnOrder?: string[];
  hiddenColumns?: string[];
  columnWidths?: number[];
}
function GridBody({
  id,
  doc,
  blockId,
  bridge,
  tableId,
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
  const [columnFormOpen, setColumnFormOpen] = useState(false);
  const [columnForm, setColumnForm] = useState<AddColumnFormDraft | null>(null);
  // The form's type-specific block stand (the catalog's flag — the number's
  // display attributes / the ref table's pick over the name).
  const columnFormNumber = columnForm?.numberKind !== undefined;
  const columnFormRef = columnForm?.refKind !== undefined;
  // The ref tables' data (the enum's dict options / the row-link's
  // displays — the live stand over the ref tables' own events; the
  // entry's key stands the table + the column's declared display column
  // (the row-link's `refDisplayColumn`)).
  const refTableEntries = useMemo(() => {
    const map = new Map<string, RefTableEntry>();
    for (const column of data.table?.columns ?? []) {
      if (column.refTableId === undefined) continue;
      const entry: RefTableEntry = {
        tableId: column.refTableId,
        displayColumn: column.refDisplayColumn,
      };
      map.set(refEntryKey(entry), entry);
    }
    return [...map.values()];
  }, [data.table?.columns]);
  const refTableData = useRefTables(bridge, refTableEntries);
  // The motion's options' editor's variant (the framer's Reorder's stand
  // over the `./motion`'s subpath — the null's stand stands the plain
  // editor, the base's boundary's contract).
  const motionEnumOptionsEditor = useEnumOptionsMotion();
  const OptionsEditor = motionEnumOptionsEditor ?? EnumOptionsEditor;
  // The table catalog (the ref form's pick list; the new-table creation
  // stands the fresh catalog over the refresh bump).
  const [catalogRefresh, setCatalogRefresh] = useState(0);
  const bridgeTables = useBridgeTables(bridge, catalogRefresh);

  /** The form's create commit (the button's press only): the name over the
   *  input, the type-specific block over the draft; the ref's new-table
   *  creation stands before the column's (the `createTable` → the
   *  `refTableId` data). The enum stands its own hidden system table (the
   *  options' rows over the `name` / the `color` columns — the table's
   *  name is derived over the data table + the column's name, so the
   *  two tabs' seeds share one table). */
  const commitColumnForm = () => {
    const draft = columnForm;
    if (draft === null || draft.name.trim() === "") return;
    const name = draft.name.trim();
    if (draft.editColumnId !== undefined) {
      commitColumnEdit(draft);
      return;
    }
    const commitRef = (refTableId: string | undefined) => {
      const columnSuffix = String((data.table?.columns.length ?? 0) + 1);
      const column: BridgeColumn = { id: `col${columnSuffix}`, name, type: draft.type };
      if (draft.numberKind !== undefined) {
        column.thousands = draft.thousands;
        if (draft.prefix !== "") column.prefix = draft.prefix;
        if (draft.suffix !== "") column.suffix = draft.suffix;
        column.allowNegative = draft.allowNegative;
        if (draft.numberKind === "decimal") column.decimals = draft.decimals;
      }
      if (draft.refKind !== undefined) {
        column.refKind = draft.refKind;
        if (draft.refMany) column.refMany = true;
        column.refTableId = refTableId;
      }
      void data.addColumn(column);
      // The create commit keeps the view's column order complete: the
      // block's explicit `columnOrder` (a previous drag committed it) stands
      // the visible order, so the new column is appended to its end — one
      // `updateBlock` (the view attr, CRDT / undo as the current ones). Read
      // fresh over the doc: the enum's commit runs in the async's tail, where
      // the render-time `columnOrder` prop stands stale. Without an explicit
      // order the bridge's schema order stands (the create appends to the end)
      // and the attr is left untouched.
      const block = doc.getBlock(blockId);
      const currentOrder = block !== null && block.type === "database" ? block.attrs.columnOrder : undefined;
      if (currentOrder !== undefined) {
        doc.updateBlock(blockId, { columnOrder: [...currentOrder, column.id] });
      }
      setColumnFormOpen(false);
      setColumnForm(null);
    };
    if (draft.refKind === "enum") {
      void bridge
        .createTable(`${tableId}-enum-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, { system: true })
        .then(async (enumTableId) => {
          await bridge.createColumn(enumTableId, {
            id: ENUM_OPTION_NAME_COLUMN,
            name: ENUM_OPTION_NAME_COLUMN,
            type: "text",
          });
          await bridge.createColumn(enumTableId, {
            id: ENUM_OPTION_COLOR_COLUMN,
            name: ENUM_OPTION_COLOR_COLUMN,
            type: "text",
          });
          for (const option of draft.enumOptions ?? []) {
            if (option.name.trim() === "") continue;
            const cells: Record<string, unknown> = { [ENUM_OPTION_NAME_COLUMN]: option.name.trim() };
            if (option.color !== null) cells[ENUM_OPTION_COLOR_COLUMN] = option.color;
            await bridge.insertRow(enumTableId, cells);
          }
          setCatalogRefresh((key) => key + 1);
          commitRef(enumTableId);
        })
        .catch(() => {
          // The system table's create failure: the form stands open (the
          // commit stands none — the retry is the form's own press).
        });
      return;
    }
    if (draft.refKind === undefined) {
      commitRef(undefined);
      return;
    }
    if (draft.refPick === NEW_TABLE_PICK) {
      const tableName = draft.newTableName.trim();
      if (tableName === "") return;
      void bridge
        .createTable(tableName)
        .then((tableId) => {
          setCatalogRefresh((key) => key + 1);
          commitRef(tableId);
        })
        .catch(() => {
          // The table's create failure: the form stands open (the commit
          // stands none — the retry is the form's own create press).
        });
      return;
    }
    if (draft.refPick === "") return; // the ref stand is required
    commitRef(draft.refPick);
  };

  /** The form's edit commit (the enum's options over the existing system
   *  table): the diff over the table's current rows (the matched's
   *  name / color's updates, the removed's removals, the added's inserts,
   *  the order's stand over the `moveRow`'s ops) + the column's name over
   *  the `renameColumn` (the undo entry's stand). The bridge's calls stand
   *  direct (the system table's rows keep no per-block undo — the create
   *  form's table-creation contract). */
  const commitColumnEdit = (draft: AddColumnFormDraft) => {
    const columnId = draft.editColumnId;
    const refTableId = draft.refPick;
    const column = data.table?.columns.find((entry) => entry.id === columnId);
    if (columnId === undefined || refTableId === "" || column === undefined) return;
    void (async () => {
      const page = await bridge.queryRows(refTableId, { limit: 200 });
      const current: { rowId: string; name: string; color: string | null }[] = [];
      for (const [rowId, cells] of Object.entries(page.rows)) {
        current.push({
          rowId,
          name: typeof cells[ENUM_OPTION_NAME_COLUMN] === "string" ? cells[ENUM_OPTION_NAME_COLUMN] : rowId,
          color: typeof cells[ENUM_OPTION_COLOR_COLUMN] === "string" ? cells[ENUM_OPTION_COLOR_COLUMN] : null,
        });
      }
      const draftOptions = (draft.enumOptions ?? []).filter((option) => option.name.trim() !== "");
      const keptRowIds = new Set<string>();
      const addedRowIds: string[] = [];
      for (let i = 0; i < draftOptions.length; i++) {
        const option = draftOptions[i];
        if (option === undefined) continue;
        if (option.rowId === undefined) {
          const cells: Record<string, unknown> = { [ENUM_OPTION_NAME_COLUMN]: option.name.trim() };
          if (option.color !== null) cells[ENUM_OPTION_COLOR_COLUMN] = option.color;
          addedRowIds.push(await bridge.insertRow(refTableId, cells));
          continue;
        }
        keptRowIds.add(option.rowId);
        const before = current.find((entry) => entry.rowId === option.rowId);
        if (before === undefined) continue;
        const cells: Record<string, unknown> = {};
        if (before.name !== option.name.trim()) cells[ENUM_OPTION_NAME_COLUMN] = option.name.trim();
        if (before.color !== (option.color ?? null)) {
          cells[ENUM_OPTION_COLOR_COLUMN] = option.color;
        }
        if (Object.keys(cells).length > 0) await bridge.updateRow(refTableId, option.rowId, cells);
      }
      for (const entry of current) {
        if (!keptRowIds.has(entry.rowId)) await bridge.removeRow(refTableId, entry.rowId);
      }
      const orderedIds = draftOptions.map((option, i) => option.rowId ?? addedRowIds[i]);
      for (let i = 0; i < orderedIds.length - 1; i++) {
        const rowId = orderedIds[i];
        const beforeRowId = orderedIds[i + 1];
        if (rowId === undefined || beforeRowId === undefined) continue;
        await bridge.moveRow(refTableId, rowId, beforeRowId);
      }
      if (column.name !== draft.name.trim()) await data.renameColumn(columnId, draft.name.trim());
      setColumnFormOpen(false);
      setColumnForm(null);
    })().catch(() => {
      // The commit's failure: the form stands open (the retry is the
      // form's own save press).
    });
  };

  /** The edit form's open (the enum's options over the column's system
   *  table): the draft prefills from the column + the ref table's data
   *  (the row order's stand, the `name`'s display, the `color`'s hex). */
  const openColumnFormEdit = (column: BridgeColumn) => {
    if (column.refKind !== "enum" || column.refTableId === undefined) return;
    const refData = refTableData[refEntryKey({ tableId: column.refTableId, displayColumn: column.refDisplayColumn })];
    const options = (refData?.rowIds ?? []).map((rowId) => ({
      rowId,
      name: refData?.displays[rowId] ?? rowId,
      color: refData?.colors[rowId] ?? null,
    }));
    setColumnForm({
      key: column.id,
      type: "enum",
      name: column.name,
      decimals: 0,
      thousands: false,
      prefix: "",
      suffix: "",
      allowNegative: true,
      refKind: "enum",
      refMany: column.refMany === true,
      refPick: column.refTableId,
      newTableName: "",
      enumOptions: options,
      editColumnId: column.id,
    });
    setColumnFormOpen(true);
  };
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  /** The in-flight column drag (pure view state): the column id, the live dx, the live drop index (the parting preview), the press-time width.
   */
  const [drag, setDrag] = useState<{ id: string; dx: number; toIndex: number | null; startWidth: number } | null>(null);
  const dragSession = useRef<ColumnDragSession | null>(null);
  const tableRef = useRef<HTMLDivElement | null>(null);

  const columns = visibleColumns(data.table?.columns, columnOrder, hiddenColumns);

  const updateView = (patch: Record<string, unknown>) => {
    doc.updateBlock(blockId, patch);
  };

  // The parting preview: the stationary columns' shift (px) over the live
  // drop index (the dragged column's own cells stand the pointer's dx).
  const dragFrom = drag === null ? -1 : columns.findIndex((entry) => entry.id === drag.id);
  const dragShiftOf = (index: number): number => {
    if (drag === null || drag.toIndex === null || index === dragFrom) return 0;
    const to = drag.toIndex;
    const shift = index < dragFrom ? (index >= to ? 1 : 0) : index - 1 < to ? -1 : 0;
    return shift * drag.startWidth;
  };

  // --- The display name: the bridge's table name (the name is the
  //     table's attribute — every block over the tableId stands it live;
  //     the block's legacy `name` attr is ignored over the display).
  const displayName = data.table?.name ?? tableId;

  // --- The column drag session (the header cell's press).
  const onColumnPointerDown = (column: BridgeColumn, event: ReactPointerEvent<HTMLDivElement>) => {
    // The menu's own controls (the Ellipsis trigger, the rename input) own
    // their presses: no drag session over them. The menu's content stands
    // portaled outside the cell's DOM — but inside its REACT tree, so a
    // press on a menu item still bubbles to this handler (the synthetic
    // dispatch follows the React tree): the capture over the portaled
    // content would retarget the item's pointerup and swallow its click.
    if (
      event.target instanceof Element &&
      event.target.closest('[data-slot="docblocks/database-column-menu"], [role="menu"]')
    ) {
      return;
    }
    const index = columns.findIndex((entry) => entry.id === column.id);
    if (index === -1) return;
    dragSession.current = {
      columnId: column.id,
      index,
      startX: event.clientX,
      ids: columns.map((entry) => entry.id),
      started: false,
      startWidth: event.currentTarget.getBoundingClientRect().width,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onColumnPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = dragSession.current;
    if (session === null) return;
    const dx = event.clientX - session.startX;
    if (!session.started && Math.abs(dx) < DRAG_START_THRESHOLD_PX) return;
    session.started = true;
    setDrag({
      id: session.columnId,
      dx,
      toIndex: columnDropIndexAt(event.clientX, session.columnId),
      startWidth: session.startWidth,
    });
  };

  /** The drop index (the dragged column's final visible index) for a
   *  pointer x: the stationary headers' midpoints (the dragged column's
   *  live position is excluded) — the position among the stationary
   *  columns IS the final visible index (the splice into the stationary
   *  order). The release's commit and the parting preview share the
   *  measurement. */
  const columnDropIndexAt = (clientX: number, excludeId: string): number | null => {
    const table = tableRef.current;
    if (table === null) return null;
    const midpoints: number[] = [];
    table.querySelectorAll<HTMLElement>("[data-slot='docblocks/database-header-cell']").forEach((cell) => {
      if (cell.dataset.columnId === excludeId) return;
      const rect = cell.getBoundingClientRect();
      midpoints.push(rect.left + rect.width / 2);
    });
    if (midpoints.length === 0) return null;
    midpoints.sort((a, b) => a - b);
    let position = 0;
    for (const mid of midpoints) {
      if (clientX > mid) position += 1;
    }
    return position;
  };

  const onColumnPointerUp = (column: BridgeColumn, event: ReactPointerEvent<HTMLDivElement>) => {
    const session = dragSession.current;
    dragSession.current = null;
    if (session === null) return;
    if (!session.started) {
      // A sub-threshold press (a click) on the header's zone stands nothing:
      // the properties' menu opens only over the Ellipsis's own press (the
      // Radix trigger — a press without movement past the threshold). The
      // name zone's cursor-grab is the drag's affordance; a click there is
      // a no-op (the drag is a past-threshold press).
      return;
    }
    setDrag(null);
    // The stale-drop guard: the visible column sequence must stand as at
    // the press (a peer added / removed / renamed-structurally a column
    // mid-drag invalidates the drop — no commit, the grid resyncs).
    if (!columns.map((entry) => entry.id).every((value, i) => session.ids[i] === value)) return;
    // The drop position among the stationary columns (the live preview's
    // measurement, re-read at the release).
    const toIndex = columnDropIndexAt(event.clientX, session.columnId);
    if (toIndex === null || toIndex === session.index) return;
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
      // The press inside the edit's own control (the number's input, the
      // text's 6-row textarea) is the edit's interaction (the caret's
      // seat, the text's selection) — the session stands, no teardown.
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
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
    // The undo / redo hotkey over the table's focus: the grid's own stack
    // (the bridge operations — the doc's undo does not cover them). The
    // focused input keeps its own history (the browser's edit commands).
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      event.stopPropagation();
      void (event.shiftKey ? data.redo() : data.undo());
      return;
    }
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
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return; // the edit's own stand
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
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
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
    if (trimmed === "" || trimmed === data.table?.name) return;
    // The rename is the bridge's (the table's attribute): every block over
    // the tableId stands the new name over the table event — no doc write,
    // the grid's undo stack covers it.
    void data.renameTable(trimmed);
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
                  <FilterBuilder
                    value={filterDraft}
                    columns={data.table.columns}
                    onChange={setFilterDraft}
                    refTableData={refTableData}
                  />
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
            // The fixed row track (the standard row height): every row —
            // over any column type mix — stands the one height (the header
            // stands its own auto row; the enum's trigger fits the content
            // box, so a new enum column grows no row). The multi-line's
            // editor stands the portaled layer (no track's shift).
            style={{
              gridTemplateRows: "auto",
              gridAutoRows: "var(--docblocks-database-row-height)",
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
                dragDx={drag !== null && drag.id === column.id ? drag.dx : dragShiftOf(index)}
                dragShifted={drag !== null && drag.id !== column.id}
                menuOpen={columnMenu === column.id}
                onMenuChange={(open) => setColumnMenu(open ? column.id : null)}
                onRename={(renameName) => void data.renameColumn(column.id, renameName)}
                onEditOptions={
                  column.refKind === "enum" && column.refTableId !== undefined
                    ? () => openColumnFormEdit(column)
                    : undefined
                }
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
                  {ADD_COLUMN_TYPES.map((entry) => {
                    const EntryIcon = columnTypeIcon(entry.type, entry.refKind, entry.refMany);
                    return (
                      <DropdownMenuItem
                        key={entry.key}
                        data-column-entry={entry.key}
                        onClick={() => {
                          // Every entry stands the create form (the name
                          // input + the type-specific block over it): the
                          // create commits on the form's button only.
                          setColumnForm(emptyColumnForm(entry));
                          setAddingColumn(false);
                          setColumnFormOpen(true);
                        }}
                      >
                        <EntryIcon className="size-4 shrink-0 text-muted-foreground" />
                        {entry.label}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
              {/* The create form (every menu entry opens it: the name
                  input + the type-specific attributes — the number's
                  display attributes stand the bridge's column data). */}
              <Popover
                open={columnFormOpen && columnForm !== null}
                onOpenChange={(open) => {
                  setColumnFormOpen(open);
                  // The close (the outside press / the Escape) drops the
                  // draft — the next open stands a fresh one.
                  if (!open) setColumnForm(null);
                }}
              >
                <PopoverTrigger asChild>
                  <span data-slot="docblocks/database-add-column-form-anchor" className="absolute size-0" />
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-72 p-3"
                  // The menu's entry stands the form: the menu's close
                  // restores the focus to the plus trigger (outside the
                  // popover content) — the focus-outside would close the
                  // form the very tick it opens. The outside press (the
                  // interact-outside) and the Escape keep the close (no
                  // create — the commit stands the form's button only).
                  onFocusOutside={(event) => event.preventDefault()}
                >
                  <div data-slot="docblocks/database-add-column-form" className="flex flex-col gap-2">
                    <label className="flex items-center gap-2 text-sm text-foreground">
                      Name
                      <input
                        type="text"
                        data-slot="docblocks/database-add-column-name"
                        className="
                          w-full cursor-text rounded-md border border-border bg-transparent px-2 py-0.5 text-sm
                          outline-none
                          focus:bg-muted/60
                        "
                        value={columnForm?.name ?? ""}
                        onChange={(event) =>
                          setColumnForm((draft) => (draft === null ? draft : { ...draft, name: event.target.value }))
                        }
                      />
                    </label>
                    {columnFormNumber && (
                      <>
                        {columnForm?.numberKind === "decimal" && (
                          <label className="flex items-center gap-2 text-sm text-foreground">
                            Decimals
                            <input
                              type="number"
                              min={0}
                              max={10}
                              data-slot="docblocks/database-add-column-decimals"
                              className="
                                w-16 cursor-text rounded-md border border-border bg-transparent px-1 py-0.5 text-sm
                                outline-none
                                focus:bg-muted/60
                              "
                              value={columnForm?.decimals ?? 0}
                              onChange={(event) =>
                                setColumnForm((draft) =>
                                  draft === null ? draft : { ...draft, decimals: Number(event.target.value) || 0 }
                                )
                              }
                            />
                          </label>
                        )}
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                          <Checkbox
                            data-slot="docblocks/database-add-column-thousands"
                            checked={columnForm?.thousands ?? false}
                            onCheckedChange={(checked) =>
                              setColumnForm((draft) =>
                                draft === null ? draft : { ...draft, thousands: checked === true }
                              )
                            }
                          />
                          Thousands' separator
                        </label>
                        <label className="flex items-center gap-2 text-sm text-foreground">
                          Prefix
                          <input
                            type="text"
                            data-slot="docblocks/database-add-column-prefix"
                            className="
                              w-full cursor-text rounded-md border border-border bg-transparent px-2 py-0.5 text-sm
                              outline-none
                              focus:bg-muted/60
                            "
                            value={columnForm?.prefix ?? ""}
                            onChange={(event) =>
                              setColumnForm((draft) =>
                                draft === null ? draft : { ...draft, prefix: event.target.value }
                              )
                            }
                          />
                        </label>
                        <label className="flex items-center gap-2 text-sm text-foreground">
                          Suffix
                          <input
                            type="text"
                            data-slot="docblocks/database-add-column-suffix"
                            className="
                              w-full cursor-text rounded-md border border-border bg-transparent px-2 py-0.5 text-sm
                              outline-none
                              focus:bg-muted/60
                            "
                            value={columnForm?.suffix ?? ""}
                            onChange={(event) =>
                              setColumnForm((draft) =>
                                draft === null ? draft : { ...draft, suffix: event.target.value }
                              )
                            }
                          />
                        </label>
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                          <Checkbox
                            data-slot="docblocks/database-add-column-negative"
                            checked={columnForm?.allowNegative ?? true}
                            onCheckedChange={(checked) =>
                              setColumnForm((draft) =>
                                draft === null ? draft : { ...draft, allowNegative: checked === true }
                              )
                            }
                          />
                          Allow negative
                        </label>
                      </>
                    )}
                    {columnFormRef && columnForm?.refKind === "enum" && (
                      /* The enum's options' editor (the create / the edit's
                          stand): the ref table's pick is out (the options
                          stand over the column's own system table — the
                          created / the edited stand). The motion's variant
                          (the framer's Reorder's rows) stands over the
                          slot's context; the plain's editor is the stand
                          over its absence. */
                      <OptionsEditor
                        options={columnForm.enumOptions ?? []}
                        onChange={(next) =>
                          setColumnForm((draft) => (draft === null ? draft : { ...draft, enumOptions: next }))
                        }
                      />
                    )}
                    {columnFormRef && columnForm?.refKind === "row" && (
                      <>
                        {/* The row-link's table's pick: the existing tables
                            + the new-table creation. The package's Select
                            (the native select is gone) — the "none" stand
                            is the sentinel pick (Radix takes no empty
                            value), the portaled list stands the standard
                            tokens (the --docblocks-* do not reach the
                            body). */}
                        <label className="flex items-center gap-2 text-sm text-foreground">
                          Table
                          <Select
                            value={
                              columnForm === null || columnForm.refPick === "" ? REF_NONE_PICK : columnForm.refPick
                            }
                            onValueChange={(next) =>
                              setColumnForm((draft) =>
                                draft === null
                                  ? draft
                                  : { ...draft, refPick: next === REF_NONE_PICK ? "" : next, newTableName: "" }
                              )
                            }
                          >
                            <SelectTrigger
                              data-slot="docblocks/database-add-column-ref"
                              className="w-full justify-start px-2 py-0.5 text-xs shadow-none data-[size=default]:h-7"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent align="start" sideOffset={4}>
                              <SelectItem value={REF_NONE_PICK}>— Select a table —</SelectItem>
                              {bridgeTables.map((table) => (
                                <SelectItem key={table.id} value={table.id}>
                                  {table.name}
                                </SelectItem>
                              ))}
                              <SelectItem value={NEW_TABLE_PICK}>New table…</SelectItem>
                            </SelectContent>
                          </Select>
                        </label>
                        {(columnForm?.refPick ?? "") === NEW_TABLE_PICK && (
                          <label className="flex items-center gap-2 text-sm text-foreground">
                            Name
                            <input
                              type="text"
                              data-slot="docblocks/database-add-column-ref-new"
                              placeholder="New table name"
                              className="
                                w-full cursor-text rounded-md border border-border bg-transparent px-2 py-0.5 text-sm
                                text-foreground outline-none
                                focus:bg-muted/60
                              "
                              value={columnForm?.newTableName ?? ""}
                              onChange={(event) =>
                                setColumnForm((draft) =>
                                  draft === null ? draft : { ...draft, newTableName: event.target.value }
                                )
                              }
                            />
                          </label>
                        )}
                      </>
                    )}
                    <button
                      type="button"
                      data-slot="docblocks/database-add-column-create"
                      // The create / the save commits on the press only
                      // (the outside press / the Escape close without the
                      // commit); the empty name / the unpicked row's table
                      // stand the disabled stand (the commit is impossible
                      // over it).
                      disabled={
                        columnForm === null ||
                        columnForm.name.trim() === "" ||
                        (columnFormRef &&
                          columnForm.refKind === "row" &&
                          (columnForm.refPick === "" ||
                            (columnForm.refPick === NEW_TABLE_PICK && columnForm.newTableName.trim() === "")))
                      }
                      className="
                        cursor-pointer rounded-md border border-border bg-accent px-2 py-1 text-sm text-foreground
                        outline-none
                        hover:opacity-70
                        disabled:cursor-not-allowed disabled:opacity-50
                      "
                      onClick={() => {
                        commitColumnForm();
                      }}
                    >
                      {columnForm?.editColumnId !== undefined ? "Save" : "Add column"}
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
                      dragDx={drag !== null && drag.id === column.id ? drag.dx : dragShiftOf(index)}
                      dragShifted={drag !== null && drag.id !== column.id}
                      selected={selectedCells.has(key)}
                      singleSelected={selectedCells.has(key) && selectedCells.size === 1}
                      editing={editingCell === key}
                      onChange={(value) => void data.updateRow(row.rowId, { [column.id]: value })}
                      onPointerDown={onCellPointerDown(row.rowId, column.id, rowIndex, index)}
                      onEditStart={() => setEditingCell(key)}
                      refTableData={
                        column.refTableId !== undefined
                          ? refTableData[
                              refEntryKey({ tableId: column.refTableId, displayColumn: column.refDisplayColumn })
                            ]
                          : undefined
                      }
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
                text-(--docblocks-placeholder-color) select-none
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
            text-(--docblocks-placeholder-color) outline-none select-none
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

export { GridBody };
