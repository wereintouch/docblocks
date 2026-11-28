/** The grid's cell (the column annotation's editor): the interaction stand
 *  (the selection / the edit) over the column's value input. */
import { format } from "date-fns";

import type { PointerEvent as ReactPointerEvent } from "react";

import { cn } from "../../../shared/ui/cn";
import { columnAnnotation } from "../../bridge";
import type { BridgeColumn, BridgeColumnAnnotation } from "../../bridge";
import {
  CELL_PASTE_RANGE,
  CELL_SELECTED,
  CELL_SELECTED_MULTI,
  CELL_WRAP,
  CHECKBOX_TOGGLE_GUARD_MS,
  GRID_DRAG_TRANSITION,
} from "../constants";
import type { RefTableData } from "../use-ref-tables";
import { cellKeyOf, dateOnly, hasTime, parseCellDateTime } from "../utils";
import { DatabaseCellContent } from "./DatabaseCellContent";
import { DatabaseCellText } from "./DatabaseCellText";
import { useCellEditSession } from "./use-cell-edit-session";

interface DatabaseCellProps {
  rowId: string;
  column: BridgeColumn;
  value: unknown;
  /** The row's live revision (the draft's open stand — the deferred
   *  commit's CAS pins the open-time one). */
  revision: string | undefined;
  rowIndex: number;
  colIndex: number;
  first: boolean;
  lastRow: boolean;
  /** The inserted row's temporary visibility outside the active filter. */
  filterPending: boolean;
  dragDx: number;
  /** A stationary column's cell of an in-flight drag (the parting shift's transition). */
  dragShifted: boolean;
  selected: boolean;
  pasteHighlighted: boolean;
  /** The cell stands the sole selection (the boolean's checkbox interactive stand). */
  singleSelected: boolean;
  editing: boolean;
  /** The draft's commit: the value + the pinned revision (the open stand —
   *  the immediate commits stand the one-arg form). */
  onChange: (value: unknown, expectedRevision?: string) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onEditStart: () => void;
  onEditEnd: () => void;
  /** The boolean's press stand (the grid's ref: the toggle's guards). */
  booleanPress: { current: { armed: boolean; toggledTs: number } };
  /** The ref table's data (the enum's dict options + the row-link's
   *  displays — the grid loads it per the column's `refTableId`). */
  refTableData?: RefTableData;
}
/**
 * The cell (the column annotation's editor). The interaction stand
 * (the single press is the selection — the grid extends it to the
 * rectangle; the double press is the edit — the input's focus for the
 * text / number, the toggle for the boolean, the picker's open for the
 * date / datetime / enum / row-link, the checkbox list for the ref's
 * many cardinality). The content-less cell stands empty (no
 * placeholder, no trigger chrome): the pickers open on the double press
 * over the cell itself.
 */
function DatabaseCell({
  rowId,
  column,
  value,
  revision,
  rowIndex,
  colIndex,
  first,
  lastRow,
  filterPending,
  dragDx,
  dragShifted,
  selected,
  pasteHighlighted,
  singleSelected,
  editing,
  onChange,
  onPointerDown,
  onEditStart,
  onEditEnd,
  booleanPress,
  refTableData,
}: DatabaseCellProps) {
  const annotation: BridgeColumnAnnotation = columnAnnotation(column);
  const empty = value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
  const isDate = annotation.valueInput === "date";
  const isDateTime = annotation.valueInput === "datetime";
  const isText = annotation.valueInput === "text";
  const isNumber = annotation.valueInput === "number";
  const dateValue = isDate || isDateTime ? parseCellDateTime(value) : null;
  const rawValue = value === undefined || value === null ? "" : String(value);
  const isManyRef = column.refKind !== undefined && column.refMany === true;
  const dragStyle =
    dragDx !== 0
      ? {
          transform: `translateX(${dragDx}px)`,
          position: "relative" as const,
          zIndex: dragShifted ? undefined : 10,
          transition: dragShifted ? GRID_DRAG_TRANSITION : undefined,
        }
      : undefined;

  const {
    textDraft,
    setTextDraft,
    commitTextDraft,
    cancelTextDraft,
    textCancelledRef,
    textSettledRef,
    openValueRef,
    openDateRef,
    openRevisionRef,
    draftDate,
    setDraftDate,
    draftTime,
    setDraftTime,
    commitDateTime,
    closeCommittedRef,
    dateTimeCancelledRef,
  } = useCellEditSession({
    editing,
    isText,
    isNumber,
    isDateTime,
    rawValue,
    revision,
    column,
    onChange,
    onEditEnd,
  });

  const content = (
    <DatabaseCellContent
      rowId={rowId}
      column={column}
      value={value}
      editing={editing}
      singleSelected={singleSelected}
      booleanPress={booleanPress}
      refTableData={refTableData}
      annotation={annotation}
      empty={empty}
      isText={isText}
      dateValue={dateValue}
      rawValue={rawValue}
      onChange={onChange}
      onEditEnd={onEditEnd}
      textDraft={textDraft}
      setTextDraft={setTextDraft}
      cancelTextDraft={cancelTextDraft}
      draftDate={draftDate}
      setDraftDate={setDraftDate}
      draftTime={draftTime}
      setDraftTime={setDraftTime}
      commitDateTime={commitDateTime}
      closeCommittedRef={closeCommittedRef}
      dateTimeCancelledRef={dateTimeCancelledRef}
    />
  );

  // The enum's overflow's stand (the value's display clipped — the
  // ellipsis / the fade's mask): the press stands the picker's popover
  // (the value's full's stand) over the selection's stand (the
  // non-overflowing's value keeps the press model — the double press is
  // the picker's stand). The single's chip truncates (the clip's measure
  // stands the chip's own box); the multi's train overflows (the clip's
  // measure stands the train's container). The open stands the click
  // (the popover's mount over the in-flight press stands the radix's
  // outside-dismiss).
  const onCellClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (annotation.valueInput !== "enum") return;
    const prober = isManyRef
      ? event.currentTarget.querySelector<HTMLElement>('[data-slot="docblocks/database-ref-chips"]')
      : event.currentTarget.querySelector<HTMLElement>('[data-slot="docblocks/database-ref-chip"]');
    if (prober !== null && prober.scrollWidth > prober.clientWidth + 1) {
      onEditStart();
    }
  };
  const onCellDoubleClick = () => {
    if (annotation.valueInput === "boolean") {
      // The interactive click's toggle already stands over the double
      // press (over the browser's double-click window) — the dblclick
      // stands no second toggle.
      if (Date.now() - booleanPress.current.toggledTs < CHECKBOX_TOGGLE_GUARD_MS) return;
      onChange(value === true ? false : true);
      return;
    }
    // The text / number's draft stands from the value at the open (the
    // double press is the session's single entry; the mid-session value
    // changes stand the draft untouched until the close commits).
    if (isText || isNumber) {
      textCancelledRef.current = false;
      textSettledRef.current = false;
      openValueRef.current = rawValue;
      openRevisionRef.current = revision;
      setTextDraft(rawValue);
    }
    // The datetime's drafts stand from the value at the open (the double
    // press is the session's single entry; the mid-session value changes
    // stand the draft untouched until the close commits).
    if (isDateTime) {
      openDateRef.current = dateValue;
      openRevisionRef.current = revision;
      setDraftDate(dateValue !== null ? dateOnly(dateValue) : null);
      setDraftTime(dateValue !== null && hasTime(dateValue) ? format(dateValue, "HH:mm:ss") : null);
    }
    onEditStart();
  };
  const cell = (
    <div
      data-slot="docblocks/database-cell"
      data-key={cellKeyOf(rowId, column.id)}
      data-row-id={rowId}
      data-filter-pending={filterPending ? "true" : undefined}
      data-row={rowIndex}
      data-col={colIndex}
      data-column-id={column.id}
      data-kind={annotation.valueInput}
      data-empty={empty ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
      data-editing={editing ? "true" : undefined}
      className={cn(
        CELL_WRAP,
        pasteHighlighted && "relative",
        !first && "border-l-(length:--docblocks-table-border-width)",
        !lastRow && "border-b-(length:--docblocks-table-border-width)",
        first && lastRow && "rounded-bl-(--docblocks-radius)",
        selected && (singleSelected ? CELL_SELECTED : CELL_SELECTED_MULTI)
      )}
      style={dragStyle}
      onPointerDown={onPointerDown}
      onClick={onCellClick}
      onDoubleClick={onCellDoubleClick}
    >
      {content}
      {pasteHighlighted && <span aria-hidden data-slot="docblocks/database-paste-range" className={CELL_PASTE_RANGE} />}
    </div>
  );
  if (isText) {
    return (
      <DatabaseCellText
        cell={cell}
        editing={editing}
        textDraft={textDraft}
        setTextDraft={setTextDraft}
        commitTextDraft={commitTextDraft}
        cancelTextDraft={cancelTextDraft}
        textCancelledRef={textCancelledRef}
        textSettledRef={textSettledRef}
        onEditEnd={onEditEnd}
      />
    );
  }
  return cell;
}

export { DatabaseCell };
