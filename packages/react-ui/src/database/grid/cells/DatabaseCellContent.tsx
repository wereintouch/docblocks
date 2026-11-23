/**
 * The cell's content's stand over the column's annotation (the per-type's
 * editors — the display / the edit stand per the value input's kind, the
 * ref value's stand — the many cardinality's chips / the checkbox list).
 */
import { format } from "date-fns";

import type { ReactNode } from "react";

import type { BridgeColumn, BridgeColumnAnnotation } from "../../bridge";
import type { RefTableData } from "../use-ref-tables";
import { dateOnly } from "../utils";
import { CellDisplay } from "./CellDisplay";
import { BooleanCell, DateCell, DateTimeCell, NumberCell } from "./DatabaseCellPickers";
import { EnumPicker } from "./EnumPicker";
import { RefMultiEditor } from "./RefMultiEditor";
import { RefValueChips } from "./RefValueChips";
import { RowLinkPicker } from "./RowLinkPicker";
import type { RefOption } from "./models";

interface DatabaseCellContentProps {
  rowId: string;
  column: BridgeColumn;
  value: unknown;
  editing: boolean;
  singleSelected: boolean;
  /** The boolean's press stand (the grid's ref: the toggle's guards). */
  booleanPress: { current: { armed: boolean; toggledTs: number } };
  /** The ref table's data (the enum's dict options + the row-link's displays). */
  refTableData?: RefTableData;
  annotation: BridgeColumnAnnotation;
  empty: boolean;
  isText: boolean;
  dateValue: Date | null;
  rawValue: string;
  onChange: (value: unknown, expectedRevision?: string) => void;
  onEditEnd: () => void;
  textDraft: string | null;
  setTextDraft: (draft: string) => void;
  cancelTextDraft: () => void;
  draftDate: Date | null;
  setDraftDate: (date: Date | null) => void;
  draftTime: string | null;
  setDraftTime: (time: string | null) => void;
  commitDateTime: () => void;
  closeCommittedRef: { current: boolean };
  dateTimeCancelledRef: { current: boolean };
}

function DatabaseCellContent({
  rowId,
  column,
  value,
  editing,
  singleSelected,
  booleanPress,
  refTableData,
  annotation,
  empty,
  isText,
  dateValue,
  rawValue,
  onChange,
  onEditEnd,
  textDraft,
  setTextDraft,
  cancelTextDraft,
  draftDate,
  setDraftDate,
  draftTime,
  setDraftTime,
  commitDateTime,
  closeCommittedRef,
  dateTimeCancelledRef,
}: DatabaseCellContentProps) {
  // The ref table's stand (the enum's options — the option's row id stands
  // the value, the display stands the label (the dict's legacy PK-as-label
  // stand stands the display too), the `color` column stands the chip's
  // color; the row-link's displays — the dead row id keeps the raw stand,
  // the lenient read).
  const refRowIds = refTableData?.rowIds ?? [];
  const refDisplays = refTableData?.displays ?? {};
  const refOptions: RefOption[] = refRowIds.map((rowId) => ({
    value: rowId,
    label: refDisplays[rowId] ?? rowId,
    color: refTableData?.colors[rowId],
  }));

  let content: ReactNode;
  const isManyRef = column.refKind !== undefined && column.refMany === true;
  // The ref value's stand (the many cardinality): the empty / the legacy
  // scalar value normalizes to the array (the editor's commit stands the
  // array always — the single scalar is the lenient read, not the state).
  const refValues = Array.isArray(value)
    ? value.map((item) => String(item))
    : isManyRef && value !== undefined && value !== null && String(value) !== ""
      ? [String(value)]
      : [];
  if (isManyRef || Array.isArray(value)) {
    // The many cardinality (the multi-enum / the row-links): the edit is
    // the popover's checkbox list (the toggle commits immediately — one
    // `updateRow` per option, the draft stands none; the commit stands the
    // array always — the first pick over the empty cell stands `[value]`),
    // the display stands the option's chips (the train over the cell — the
    // joined text is out; the non-ref array keeps the raw join — the
    // lenient stand).
    if (editing && column.refKind !== undefined) {
      content = <RefMultiEditor values={refValues} options={refOptions} onCommit={onChange} onEditEnd={onEditEnd} />;
    } else if (column.refKind !== undefined) {
      content = <RefValueChips values={refValues} options={refOptions} fade />;
    } else {
      content = <CellDisplay text={refValues.join(", ")} />;
    }
  } else {
    const noOp = () => undefined;
    const clearValue = () => onChange(null);
    const dateOnOpenChange = (open: boolean) => {
      if (!open) onEditEnd();
    };
    const onDateSelect = (day: Date | undefined) => {
      // The pick commits the ISO date (the same-day pick clears it — the
      // day-picker's toggle) + closes the popover.
      const next = day === undefined || day === null ? null : dateOnly(day);
      onChange(next === null ? null : format(next, "yyyy-MM-dd"));
      onEditEnd();
    };
    // The day-picker's same-day toggle (the undefined stand) resets no
    // draft date: the datetime's commit is deferred to the close, so the
    // toggle would clear the draft date and lose the typed time (the clear
    // stand is the date cell's immediate-commit contract only).
    const onDateTimeDaySelect = (day: Date | undefined) => {
      if (day === undefined || day === null) return;
      setDraftDate(dateOnly(day));
    };
    const dateTimeOnOpenChange = (open: boolean) => {
      if (!open) {
        closeCommittedRef.current = true;
        // The Escape's cancel stand: the flag keeps the commit out (the
        // onEscapeKeyDown's preventDefault stands the radix's own close
        // out — the guard stands the radix's close paths' parity).
        if (!dateTimeCancelledRef.current) commitDateTime();
        onEditEnd();
      }
    };
    // The Escape's cancel: the draft's drop (no write over the wire) — the
    // session's close stands over the grid's teardown stand (the flag's
    // guard above keeps the commit out).
    const cancelDateTimeDraft = () => {
      dateTimeCancelledRef.current = true;
      onEditEnd();
    };
    // The Enter's commit stand (the popover's keys): the commit + the close
    // stand the draft (the date + the time as set); the day's button keeps
    // the native's activation (the `data-day` hook's stand — the pick
    // stands the draft, the popover stands open over the time's input).
    const onDateTimePopoverKeyDown = (event: React.KeyboardEvent) => {
      if (event.key !== "Enter") return;
      if ((event.target as HTMLElement).closest("[data-day]") !== null) return;
      event.preventDefault();
      closeCommittedRef.current = true;
      commitDateTime();
      onEditEnd();
    };
    // The press stands the toggle only over the armed stand (the cell
    // stood the sole selection at the press — the selecting press stands
    // no toggle; the double press's second click is the detail guard).
    // The toggle's timestamp arms the wrapper's dblclick guard.
    const onCheckboxPress = (event: React.MouseEvent<HTMLSpanElement>) => {
      if (event.detail > 1) return;
      if (!booleanPress.current.armed) return;
      booleanPress.current.toggledTs = Date.now();
      onChange(value === true ? false : true);
    };

    switch (annotation.valueInput) {
      case "number":
        content = (
          <NumberCell
            column={column}
            empty={empty}
            editing={editing}
            rawValue={rawValue}
            textDraft={textDraft}
            setTextDraft={setTextDraft}
            onEnd={onEditEnd}
            onCancel={cancelTextDraft}
          />
        );
        break;
      case "date":
        content = (
          <DateCell
            dateValue={dateValue}
            editing={editing}
            dateOnOpenChange={dateOnOpenChange}
            onDateSelect={onDateSelect}
          />
        );
        break;
      case "datetime":
        content = (
          <DateTimeCell
            rowId={rowId}
            column={column}
            dateValue={dateValue}
            editing={editing}
            draftDate={draftDate}
            draftTime={draftTime}
            setDraftTime={setDraftTime}
            onDateTimeDaySelect={onDateTimeDaySelect}
            dateTimeOnOpenChange={dateTimeOnOpenChange}
            onDateTimePopoverKeyDown={onDateTimePopoverKeyDown}
            cancelDateTimeDraft={cancelDateTimeDraft}
          />
        );
        break;
      case "boolean":
        content = (
          <BooleanCell
            column={column}
            value={value}
            editing={editing}
            singleSelected={singleSelected}
            onCheckboxPress={onCheckboxPress}
            noOp={noOp}
          />
        );
        break;
      case "enum":
        content = (
          <EnumPicker
            options={refOptions}
            current={value === undefined || value === null ? null : String(value)}
            open={editing}
            onPick={onChange}
            onClear={clearValue}
            onEditEnd={onEditEnd}
          />
        );
        break;
      case "row-link":
        content = (
          <RowLinkPicker
            rowIds={refRowIds}
            displays={refDisplays}
            current={empty ? "" : rawValue}
            open={editing}
            onPick={onChange}
            onClear={clearValue}
            onEditEnd={onEditEnd}
          />
        );
        break;
      default:
        // The multi-line stand (the text's cell): the edit stands the
        // floating editor over the cell (a portaled layer: the top edge
        // over the cell's top edge, the box's
        // 6 rows stand over the rows below — the rows keep their fixed
        // track, the layout stands no shift). The display stands none while
        // the edit is open (the duplication is out), the Enter stands the
        // soft break (the raw \n — no commit), the close (the blur / the
        // session's teardown) commits the draft in one updateRow, the
        // Escape cancels (no write).
        content = editing && isText ? null : <CellDisplay text={empty ? "" : String(value)} />;
    }
  }
  return content;
}

export { DatabaseCellContent };
