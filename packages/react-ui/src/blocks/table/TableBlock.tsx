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

import { useEditorContext } from "../../EditorProvider";
import { focusCaretIn } from "../../editing/block-commands";
import { Button } from "../../shared/ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../shared/ui/DropdownMenu";
import { cn } from "../../shared/ui/cn";
import { Plus } from "../../shared/ui/icons";
import { BlockContext, useBlockContextValue } from "../block-context";
import { useFormatPalette } from "../format-palette-context";
import { TableRow } from "./TableCells";
import { HandleMenu, HandleMenuItems } from "./TableHandleMenu";
import {
  ADD_BUTTON_CLASSES,
  ADD_BUTTON_SIZE,
  DRAG_THRESHOLD,
  EMPTY_IDS,
  GHOST_ROW_HEIGHT,
  HANDLE_SIZE,
  HANDLE_ZONE,
  MIN_COLUMN_WIDTH,
} from "./models";
import type {
  AddChipSession,
  ColumnResizeSession,
  HandleAction,
  HandleKind,
  TableDragPreview,
  TableHandleSession,
} from "./models";
import {
  addDragCount,
  cellPlainText,
  clampColumnWidth,
  columnDropPosition,
  pasteCellText,
  readClipboardText,
  rowDropPosition,
  sameSequence,
} from "./utils";

function TableBlock({ id, block }: { id: BlockId; block: TableBlockType }) {
  const { doc } = useEditorContext();
  const palette = useFormatPalette();
  const rows = block.children ?? EMPTY_IDS;
  const contextValue = useBlockContextValue(id, rows, "table");
  // The doc's column widths and the rendered ones (the resize drag's live
  // preview overrides the dragged column locally — no wire traffic until
  // the release commits the width).
  const docWidths = Array.from(
    { length: block.attrs.cols },
    (_, index) => block.attrs.columnWidths?.[index] ?? DEFAULT_TABLE_COLUMN_WIDTH
  );
  const [resizePreview, setResizePreview] = useState<{ col: number; width: number } | null>(null);
  const widths =
    resizePreview !== null
      ? docWidths.map((width, i) => (i === resizePreview.col - 1 ? resizePreview.width : width))
      : docWidths;
  const tableWidth = widths.reduce((sum, width) => sum + width, 0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [rowButtonLeft, setRowButtonLeft] = useState(0);
  const [hover, setHover] = useState<{ row: number; col: number } | null>(null);
  const [menu, setMenu] = useState<{ kind: HandleKind; index: number } | null>(null);
  const [preview, setPreview] = useState<TableDragPreview | null>(null);
  const [rowMetrics, setRowMetrics] = useState<{ top: number; height: number }[]>([]);
  const sessionRef = useRef<TableHandleSession | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  // The cell context menu (the right-click): the anchor point (frame-relative)
  // and the cell; the menu's content carries the copy/paste/clear items.
  const [ctx, setCtx] = useState<{ x: number; y: number; cellId: BlockId } | null>(null);
  const resizeSessionRef = useRef<ColumnResizeSession | null>(null);
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
    const table = tableEl();
    const startSize =
      kind === "column"
        ? (block.attrs.columnWidths?.[index] ?? DEFAULT_TABLE_COLUMN_WIDTH)
        : (table?.querySelectorAll<HTMLTableRowElement>("tbody > tr")[index]?.offsetHeight ?? 0);
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
      startSize,
    };
  };

  /**
   * The dragged column's drop index (the final visible index — the
   * pre-move doc index of the landing slot) for a pointer x: the
   * stationary columns' widths (the dragged column's own width is
   * excluded) against the table's left edge — the release's commit and
   * the live parting preview share the measurement.
   */
  const columnToIndexAt = (clientX: number, excludeIndex: number): number | null => {
    const table = tableEl();
    if (table === null) return null;
    const live = doc.getBlock(id);
    if (live === null || live.type !== "table") return null;
    const rect = table.getBoundingClientRect();
    const resolved =
      live.attrs.columnWidths ?? Array.from({ length: live.attrs.cols }, () => DEFAULT_TABLE_COLUMN_WIDTH);
    const stationary = resolved.filter((_, i) => i !== excludeIndex);
    const position = columnDropPosition(stationary, clientX - rect.left);
    return position;
  };

  /** The dragged row's drop index (the final visible index — the pre-move
   *  doc index of the landing slot) for a pointer y: the stationary rows'
   *  midpoints (the dragged row is excluded) against the table's top edge
   *  — the release's commit and the live parting preview share the
   *  measurement. */
  const rowToIndexAt = (clientY: number, excludeIndex: number): number | null => {
    const table = tableEl();
    if (table === null) return null;
    const rect = table.getBoundingClientRect();
    const midpoints: number[] = [];
    Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody > tr")).forEach((tr, i) => {
      if (i === excludeIndex) return;
      midpoints.push(tr.offsetTop + tr.offsetHeight / 2);
    });
    const position = rowDropPosition(midpoints, clientY - rect.top);
    return position;
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
    if (session.dragging) {
      const toIndex =
        session.kind === "column"
          ? columnToIndexAt(event.clientX, session.index)
          : rowToIndexAt(event.clientY, session.index);
      setPreview({ kind: session.kind, index: session.index, dx, dy, toIndex, startSize: session.startSize });
    }
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

  /**
   * A seam press: starts the resize session (the native click / selection
   * is suppressed — the release commits the width or stands a no-op).
   */
  const onSeamPointerDown = (col: number) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || resizeSessionRef.current !== null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const startWidth = docWidths[col - 1] ?? MIN_COLUMN_WIDTH;
    resizeSessionRef.current = { col, startX: event.clientX, startWidth, width: startWidth };
  };

  const onSeamPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = resizeSessionRef.current;
    if (session === null) return;
    session.width = clampColumnWidth(session.startWidth + (event.clientX - session.startX));
    setResizePreview({ col: session.col, width: session.width });
  };

  /**
   * The seam release: the clamped width commits when it changed (one
   * command, one undo step); a 0 px drag stands a no-op (no wire traffic).
   */
  const onSeamPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = resizeSessionRef.current;
    resizeSessionRef.current = null;
    setResizePreview(null);
    if (session === null || session.width === session.startWidth) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    try {
      doc.setTableColumnWidth(id, session.col - 1, session.width);
    } catch {
      // A rejected width (a concurrent structural change won the race):
      // the doc stands as-is, the preview stands the doc's width.
    }
  };

  const onSeamPointerCancel = () => {
    resizeSessionRef.current = null;
    setResizePreview(null);
  };

  /**
   * The add chip's press: starts the drag session (the capture keeps the
   * moves / the release on the chip). No preventDefault — the press's
   * click must stand (the no-drag release's single insert is the click
   * path; the pointerdown's preventDefault would suppress it).
   */
  const onAddChipPointerDown = (kind: HandleKind) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (
      event.button !== 0 ||
      addSessionRef.current !== null ||
      sessionRef.current !== null ||
      resizeSessionRef.current !== null
    )
      return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    addSessionRef.current = {
      kind,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
      rows: [...rows],
      cols: block.attrs.cols,
      widths: block.attrs.columnWidths ?? null,
    };
  };

  const onAddChipPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = addSessionRef.current;
    if (session === null) return;
    const dx = event.clientX - session.startX;
    const dy = event.clientY - session.startY;
    if (!session.dragging && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
      session.dragging = true;
    }
    if (!session.dragging) return;
    const total = session.kind === "row" ? session.rows.length : session.cols;
    const delta = session.kind === "row" ? dy : dx;
    setAddPreview({ kind: session.kind, count: addDragCount(session.kind, total, delta) });
  };

  const onAddChipPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = addSessionRef.current;
    addSessionRef.current = null;
    setAddPreview(null);
    if (session === null) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!session.dragging) return; // the click path (the chip's onClick) adds one
    // The drag's release: whatever the commit's outcome (the count's
    // commit, the zero-count no-op, the stale guard's rejection), the
    // capture's click stands the drag, not a new press — suppress it.
    addDragClickRef.current = true;
    commitAddDrag(session, event.clientX, event.clientY);
  };

  const onAddChipPointerCancel = () => {
    addSessionRef.current = null;
    setAddPreview(null);
  };

  /**
   * The chip drag's release commit: the count's appends (at the end) or
   * the last-count removals in one transact (one undo step, one wire
   * update); a concurrent structural change invalidates the drop (the
   * stale guard, the handle's contract) — no command, the rows resync.
   */
  const commitAddDrag = (session: AddChipSession, clientX: number, clientY: number) => {
    const total = session.kind === "row" ? session.rows.length : session.cols;
    const delta = session.kind === "row" ? clientY - session.startY : clientX - session.startX;
    const count = addDragCount(session.kind, total, delta);
    if (count === 0) return;
    const live = doc.getBlock(id);
    if (live === null || live.type !== "table") return;
    if (!sameSequence(doc.getChildren(id), session.rows)) return;
    if (live.attrs.cols !== session.cols) return;
    if (session.kind === "column" && !sameSequence(live.attrs.columnWidths ?? [], session.widths ?? [])) return;
    try {
      doc.transact(() => {
        const current = doc.getBlock(id);
        if (current === null || current.type !== "table") return;
        if (count > 0) {
          for (let i = 0; i < count; i++) {
            if (session.kind === "row") doc.insertTableRow(id);
            else doc.insertTableColumn(id);
          }
        } else {
          for (let i = 0; i < -count; i++) {
            if (session.kind === "row") {
              const rowId = session.rows[session.rows.length - 1 - i];
              if (rowId !== undefined) doc.removeTableRow(id, rowId);
            } else {
              doc.removeTableColumn(id, session.cols - 1 - i);
            }
          }
        }
      });
    } catch {
      // A rejected command (a concurrent structural change won the race):
      // the doc stands as-is, the preview stands the doc's structure.
    }
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

  /** The drag's release commit (the stale-drop guard, then the move command). */
  const commitHandleDrag = (session: TableHandleSession, clientX: number, clientY: number) => {
    const live = doc.getBlock(id);
    if (live === null || live.type !== "table") return;
    try {
      if (session.kind === "column") {
        // A concurrent structural change (the cols count or the width
        // sequence) invalidates the drop: the column identity stands on the
        // position + its width, and a peer restructure breaks both.
        const liveWidths = live.attrs.columnWidths ?? null;
        if (live.attrs.cols !== session.cols || !sameSequence(liveWidths ?? [], session.widths ?? [])) return;
        const toIndex = columnToIndexAt(clientX, session.index);
        if (toIndex !== null && toIndex !== session.index) {
          // The visible landing slot S → the doc's pre-move target index
          // (the core's move lands before the target on a rightward move):
          // S right of the origin is one past the landing slot.
          doc.moveTableColumn(id, session.index, toIndex > session.index ? toIndex + 1 : toIndex);
        }
      } else {
        // The row identity is the id: a changed row sequence (a peer
        // insert/remove/move) invalidates the drop.
        const liveRows = doc.getChildren(id);
        if (!sameSequence(liveRows, session.rowIds)) return;
        const toIndex = rowToIndexAt(clientY, session.index);
        if (toIndex !== null && toIndex !== session.index) {
          doc.moveTableRow(id, session.rowId, toIndex > session.index ? toIndex + 1 : toIndex);
        }
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
  const columnTransforms = widths.map((_, index) => columnDragTransformOf(index));

  return (
    <div ref={frameRef} data-slot="docblocks/table-scroll" className="group relative my-(--docblocks-block-spacing)">
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
                          colSpan={block.attrs.cols}
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
              onOpenChange={(open) => {
                if (!open) setMenu(null);
              }}
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
                onAction={(action) => handleAction("row", rowIndex, action)}
                onColor={(color) => handleSetColor("row", rowIndex, color)}
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
            addPreview.kind === "column" ? block.attrs.cols + addPreview.count : block.attrs.cols
          } × ${addPreview.kind === "row" ? rows.length + addPreview.count : rows.length}`}
        </div>
      ) : null}
      {/* The cell's right-click menu: the 0×0 trigger stands at the pointer
          (frame-relative) while the menu is open — the content anchors to
          the cursor, like a native context menu. */}
      <DropdownMenu modal={false} open={ctx !== null} onOpenChange={(open) => !open && setCtx(null)}>
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
          onFocusOutside={(event) => event.preventDefault()}
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
