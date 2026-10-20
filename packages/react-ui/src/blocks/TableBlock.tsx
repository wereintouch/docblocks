import { useStore } from "zustand";

import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  ClipboardEvent,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  PointerEvent as ReactPointerEvent,
} from "react";

import type { Block, BlockId, Doc, TableBlock as TableBlockType } from "docblocks-core";
import { BLOCK_REGISTRY, DEFAULT_TABLE_COLUMN_WIDTH } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import { focusCaretIn, focusCellActivation } from "../editing/block-commands";
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
import { BlockContext, useBlockContext, useBlockContextValue } from "./block-context";
import { useFormatPalette } from "./format-palette-context";
import { useTextInner } from "./text-inner";

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
// The add chip's drag step: the rows stand the row's travel (24 px per
// row), the columns stand the base column's width (a whole column's
// travel adds one — the ghosts stand the same width).
const ADD_ROW_DRAG_STEP_PX = 24;
const ADD_COLUMN_DRAG_STEP_PX = DEFAULT_TABLE_COLUMN_WIDTH;
// The ghost row's height (the add preview's rows stand the table's minimum
// row height — the real rows' heights are content-dependent).
const GHOST_ROW_HEIGHT = 28;

/** The minimum width a column can be resized to (px; a drag below it clamps).
 */
const MIN_COLUMN_WIDTH = 50;

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

/**
 * The plain text of the cell's content (the context menu's copy payload):
 * the cell's own text (the soft breaks stand as the run's `\n`) first, then
 * the text children's text joined with `\n` between the blocks; the
 * non-text children contribute nothing (v1). Parts the cell carries no
 * text in are skipped.
 */
function cellPlainText(doc: Doc, cellId: BlockId): string {
  const cell = doc.getBlock(cellId);
  if (cell === null || cell.type !== "table-cell") return "";
  const parts: string[] = [];
  // The cell's own content stands above the children (the text-cell shape).
  const own = doc.getText(cellId);
  if (own !== "") parts.push(own);
  for (const child of cell.children ?? []) {
    const block = doc.getBlock(child);
    if (block === null || !BLOCK_REGISTRY[block.type].content) continue;
    parts.push(doc.getText(child));
  }
  return parts.join("\n");
}

/**
 * The context menu's paste seat: the plain text lands at the end of the
 * cell's LAST text child (the menu carries no caret context, v1); a cell
 * without a text child gets a fresh paragraph (a cell whose own runs
 * stand still takes the children — the layer is the typed-text surface,
 * the menu paste is the block-content one). One transact (one undo step,
 * one wire update); the multi-line text stands as soft breaks — the cell
 * paragraphs are plain text only, like the cell's paste pipeline.
 */
function pasteCellText(doc: Doc, cellId: BlockId, text: string): { blockId: BlockId; offset: number } | null {
  if (text === "") return null;
  const normalized = text.replace(/\r\n?/g, "\n");
  // The seat target survives the transact via a property (a closure-
  // assigned variable is not flow-narrowed past the call).
  const seat: { target: { blockId: BlockId; offset: number } | null } = { target: null };
  doc.transact(() => {
    const cell = doc.getBlock(cellId);
    if (cell === null || cell.type !== "table-cell") return;
    const children = cell.children ?? [];
    let existing: BlockId | null = null;
    for (let i = children.length - 1; i >= 0; i--) {
      const child = doc.getBlock(children[i]!);
      if (child !== null && BLOCK_REGISTRY[child.type].content) {
        existing = children[i]!;
        break;
      }
    }
    if (existing !== null) {
      const length = doc.getTextLength(existing);
      doc.insertText(existing, length, normalized);
      seat.target = { blockId: existing, offset: length + normalized.length };
    } else {
      const paragraph = doc.insertBlock("paragraph", undefined, { parent: cellId });
      doc.insertText(paragraph, 0, normalized);
      seat.target = { blockId: paragraph, offset: normalized.length };
    }
  });
  return seat.target;
}

/**
 * The clipboard's plain text (the context menu's paste payload): the
 * text/plain item wins; an html-only payload degrades to its plain text
 * (the marks are dropped — the cell paragraphs stand plain text only).
 * An unreadable clipboard (a read the page may not allow) stands an empty
 * string (the paste is a no-op).
 */
async function readClipboardText(): Promise<string> {
  let items: ClipboardItems;
  try {
    items = await navigator.clipboard.read();
  } catch {
    return "";
  }
  let html = "";
  for (const item of items) {
    const types = item.types;
    if (types.includes("text/plain")) {
      const blob = await item.getType("text/plain");
      return blob.text();
    }
    if (html === "" && types.includes("text/html")) {
      const blob = await item.getType("text/html");
      html = await blob.text();
    }
  }
  return html === "" ? "" : plainTextOfHtml(html);
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
  /** The dragged row / column's width / height at the press (the parting preview's shift step). */
  startSize: number;
}

/**
 * The live drag preview (the moved handle's translation + the parting
 * shift of the stationary rows / columns) — view state: the doc is
 * untouched until the release commit.
 */
interface TableDragPreview {
  kind: HandleKind;
  index: number;
  dx: number;
  dy: number;
  /** The live drop index (the dragged row / column's final index; null while unmeasurable). */
  toIndex: number | null;
  /** The dragged row / column's press-time width / height (the parting step). */
  startSize: number;
}

/**
 * The in-flight column-resize press: the column (the one LEFT of the seam)
 * and the press-time width the drag's delta applies to; `width` is the
 * live (clamped) width the preview renders and the release commits.
 */
interface ColumnResizeSession {
  col: number;
  startX: number;
  startWidth: number;
  width: number;
}

/** The resize width's clamp: the 50 px floor, no ceiling (the overflow scrolls). */
function clampColumnWidth(width: number): number {
  return Math.max(Math.round(width), MIN_COLUMN_WIDTH);
}

/**
 * The add chip's drag delta -> the count (positive = the add, negative =
 * the remove): the nearest step's count (the rows' step 24 px, the
 * columns' the base width 100 px); the floor clamps the removal to keep
 * at least one row / column (the full removal is the handle's menu
 * delete only — the paragraph conversion), the add stands unclamped (the
 * travel's count is the intent).
 */
function addDragCount(kind: HandleKind, total: number, delta: number): number {
  const step = kind === "row" ? ADD_ROW_DRAG_STEP_PX : ADD_COLUMN_DRAG_STEP_PX;
  const raw = Math.round(delta / step);
  if (raw >= 0) return raw;
  return Math.max(1 - total, raw);
}

/**
 * The in-flight add-chip press: the captured geometry and the press-time
 * snapshot (the row ids / the cols / the widths) the release commit
 * validates against (the stale guard, the handle's contract).
 */
interface AddChipSession {
  kind: HandleKind;
  startX: number;
  startY: number;
  dragging: boolean;
  rows: string[];
  cols: number;
  widths: number[] | null;
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
 * center when part of the table is scrolled out). A chip press and drag
 * adds or removes SEVERAL at once (the vertical delta for the rows, the
 * horizontal for the columns, one per 24 px — down / right adds, up /
 * left removes the last N, the floor keeps one; the live preview stands
 * the ghost rows / columns or the dimmed last ones, view state only; the
 * release commits the count in one transact, the stale guard stands the
 * handle's contract). The size stand (the columns × the rows) stands the
 * frame's top-left corner.
 */
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
  dragTransition,
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
  /** A stationary chip of an in-flight drag (the parting shift's transition). */
  dragTransition?: boolean;
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
          style={{
            left: left + dragDx,
            top: top + dragDy,
            ...(dragTransition !== undefined ? { transition: "left 120ms ease-out, top 120ms ease-out" } : {}),
          }}
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
      className={`
        border-(length:--docblocks-table-border-width) border-(--docblocks-table-border-color)
        p-(--docblocks-table-cell-padding) align-top
      `}
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

export {
  TableBlock,
  cellPlainText,
  columnDropPosition,
  pasteCellText,
  readClipboardText,
  rowDropPosition,
  clampColumnWidth,
};
export type { ColumnResizeSession, HandleKind, TableHandleSession, TableDragPreview };
