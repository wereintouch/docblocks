/** The grid's cell (the column annotation's editor): the interaction stand
 *  (the selection / the edit) over the column's value input. */
import { format } from "date-fns";

import { useEffect, useRef, useState } from "react";
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";

import { Calendar } from "../../../shared/ui/Calendar";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "../../../shared/ui/Popover";
import { Separator } from "../../../shared/ui/Separator";
import { Textarea } from "../../../shared/ui/Textarea";
import { TimeSegments } from "../../../shared/ui/TimeSegments";
import { cn } from "../../../shared/ui/cn";
import { preventDefault } from "../../../shared/utils";
import { columnAnnotation, parseCellValue } from "../../bridge";
import type { BridgeColumn, BridgeColumnAnnotation } from "../../bridge";
import { formatNumberValue } from "../../number-format";
import { CELL_SELECTED, CELL_SELECTED_MULTI, CELL_WRAP, CHECKBOX_TOGGLE_GUARD_MS } from "../constants";
import type { RefTableData } from "../use-ref-tables";
import {
  cellKeyOf,
  dateOnly,
  dateTimeLabel,
  hasTime,
  numberDisplayAttrs,
  numberStepFor,
  parseCellDateTime,
} from "../utils";
import { CellDisplay } from "./CellDisplay";
import { CellEditInput } from "./CellEditInput";
import { EnumPicker } from "./EnumPicker";
import { RefMultiEditor } from "./RefMultiEditor";
import { RefValueChips } from "./RefValueChips";
import { RowLinkPicker } from "./RowLinkPicker";
import type { RefOption } from "./models";

interface DatabaseCellProps {
  rowId: string;
  column: BridgeColumn;
  value: unknown;
  rowIndex: number;
  colIndex: number;
  first: boolean;
  lastRow: boolean;
  dragDx: number;
  /** A stationary column's cell of an in-flight drag (the parting shift's transition). */
  dragShifted: boolean;
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
  rowIndex,
  colIndex,
  first,
  lastRow,
  dragDx,
  dragShifted,
  selected,
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
  const dragStyle =
    dragDx !== 0
      ? {
          transform: `translateX(${dragDx}px)`,
          position: "relative" as const,
          zIndex: dragShifted ? undefined : 10,
          transition: dragShifted ? "transform 120ms ease-out" : undefined,
        }
      : undefined;
  // The text / number's draft stands from the value at the session's open
  // (like the datetime's own stand below): the grid's session teardown — the
  // outside press, the other cell's press — drops the `editing` prop before
  // the input's blur stands (the input unmounts with the session), so the
  // close commits the draft on the teardown itself (the cancel / the
  // repeat guards keep the no-write + the double stand a no-write).
  const [textDraft, setTextDraft] = useState<string | null>(null);
  const textCancelledRef = useRef(false);
  const textSettledRef = useRef(false);

  // The multi-line edit's caret seat (the autoFocus's start seat): the
  // session's open focuses the editor and seats the caret at the value's
  // end (the edit stands over the existing text's tail). The seat stands
  // the textarea's ref callback (the portal's content attaches after the
  // commit's effects — a commit-time effect stands the null ref out), the
  // element's identity keeps the re-renders' re-focus out (the typing's
  // caret is never moved), the close's reset stands the next open's
  // re-seat.
  const multiLineSeatRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!editing) multiLineSeatRef.current = null;
  }, [editing]);
  const multiLineRefCallback = (el: HTMLTextAreaElement | null) => {
    if (el !== null && editing && multiLineSeatRef.current !== el) {
      multiLineSeatRef.current = el;
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    }
  };

  /** The draft's close commit (the single commit path — the blur and the
   * external teardown both end the session, the session's end commits):
   * the parse's invalid stand no commit, the negative's reject stand no
   * commit, the unchanged value stand no commit (no bridge call, no
   * refetch, no no-op undo entry). */
  const commitTextDraft = () => {
    const draft = textDraft;
    if (draft === null) return;
    const result = parseCellValue(isNumber ? "number" : "text", draft);
    if (result.ok === false) return;
    const parsed = result.value;
    const rejected = isNumber && column.allowNegative === false && parsed !== null && Number(parsed) < 0;
    if (rejected) return;
    const unchanged =
      parsed === null
        ? value === undefined || value === null
        : value !== undefined && value !== null && value === parsed;
    if (!unchanged) onChange(parsed);
  };

  /** The Escape's cancel: the session closes without a commit (no write
   * over the wire). */
  const cancelTextDraft = () => {
    textCancelledRef.current = true;
    onEditEnd();
  };

  // The external teardown's commit stand (the text / the number — the
  // datetime's own stand below): the grid's session clear (the outside
  // press, the other cell's press) drops the `editing` prop before the
  // input's blur stands, so the draft commits on the teardown itself.
  // The draft + the value stand as of the flip's render: a later draft
  // change is impossible (the input unmounts with the close).
  useEffect(() => {
    if (editing) return;
    if (textDraft === null || textCancelledRef.current || textSettledRef.current) return;
    textSettledRef.current = true;
    commitTextDraft();
  }, [editing]);

  // The datetime's drafts stand from the value at the session's open (the
  // close commits; the in-flight draft never touches the consumer state and
  // stands the mid-session value changes — the picker session's own data
  // until the release).
  const [draftDate, setDraftDate] = useState<Date | null>(null);
  const [draftTime, setDraftTime] = useState<string | null>(null);

  const commitDateTime = () => {
    const committed = draftDate === null ? null : dateOnly(draftDate);
    if (draftTime !== null && committed !== null) {
      const [hours, minutes, seconds] = draftTime.split(":");
      committed.setHours(Number(hours), Number(minutes), Number(seconds));
    }
    // A no-op close (the draft stands the value) stands no commit.
    if ((committed?.getTime() ?? null) === (dateValue?.getTime() ?? null)) return;
    let iso: string | null;
    if (committed === null) {
      iso = null;
    } else {
      const base = format(committed, "yyyy-MM-dd");
      if (!hasTime(committed)) {
        iso = base;
      } else {
        const time = format(committed, "HH:mm");
        iso = committed.getSeconds() !== 0 ? `${base}T${time}:${format(committed, "ss")}` : `${base}T${time}`;
      }
    }
    // A repeat close (the popover's own dispatch after the teardown stand)
    // re-emits the same ISO — the guard (per session: the open resets it)
    // keeps it a no-write.
    if (iso === committedIsoRef.current) return;
    committedIsoRef.current = iso;
    onChange(iso);
  };

  // The external teardown's commit stand: the grid's session clear (the
  // outside press, the other cell's press) drops the popover's `open` prop
  // without the radix's close callback (the popover unmounts before its
  // deferred dispatch), so the deferred close commit never stands — the
  // cell commits the draft on the teardown itself (the no-op + repeat
  // guards above keep the double stand a no-write).
  const sessionStoodOpenRef = useRef(false);
  const closeCommittedRef = useRef(false);
  const committedIsoRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!isDateTime) return;
    if (editing) {
      sessionStoodOpenRef.current = true;
      closeCommittedRef.current = false;
      // The repeat-commit guard stands per session: a later session may
      // legitimately re-commit an earlier ISO (the value moved away and
      // back), so the open resets it.
      committedIsoRef.current = undefined;
      return;
    }
    if (!sessionStoodOpenRef.current || closeCommittedRef.current) return;
    sessionStoodOpenRef.current = false;
    commitDateTime();
  }, [editing]);

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
        commitDateTime();
        onEditEnd();
      }
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
            draft={textDraft ?? ""}
            kind="number"
            min={column.allowNegative === false ? 0 : undefined}
            step={numberStepFor(column)}
            onDraftChange={setTextDraft}
            onEnd={onEditEnd}
            onCancel={cancelTextDraft}
            alignRight
          />
        ) : (
          <CellDisplay text={empty ? "" : display} alignRight />
        );
        break;
      }
      case "date":
        content = (
          <Popover open={editing} onOpenChange={dateOnOpenChange}>
            <PopoverTrigger asChild>
              <CellDisplay text={dateValue !== null ? format(dateValue, "dd.MM.yyyy") : ""} />
            </PopoverTrigger>
            <PopoverContent align="start" sideOffset={4} className="w-auto p-0">
              <Calendar
                mode="single"
                selected={dateValue ?? undefined}
                {...(dateValue !== null ? { defaultMonth: dateValue } : {})}
                onSelect={onDateSelect}
              />
            </PopoverContent>
          </Popover>
        );
        break;
      case "datetime":
        content = (
          <Popover open={editing} onOpenChange={dateTimeOnOpenChange}>
            <PopoverTrigger asChild>
              <CellDisplay text={dateValue !== null ? dateTimeLabel(dateValue) : ""} />
            </PopoverTrigger>
            <PopoverContent align="start" sideOffset={4} className="w-auto p-0">
              <Calendar
                mode="single"
                selected={draftDate ?? undefined}
                defaultMonth={dateValue ?? undefined}
                onSelect={onDateTimeDaySelect}
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
              "flex w-full items-center justify-center px-1",
              checkboxInteractive ? "cursor-pointer" : "pointer-events-none"
            )}
            onClick={onCheckboxPress}
          >
            <Checkbox
              data-slot="docblocks/database-cell-checkbox"
              aria-label={column.name}
              checked={value === true}
              onCheckedChange={noOp}
              className="pointer-events-none"
            />
          </span>
        );
        break;
      }
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
        // floating editor over the cell (the Baserow's stand — the
        // portaled layer: the top edge over the cell's top edge, the box's
        // 6 rows stand over the rows below — the rows keep their fixed
        // track, the layout stands no shift). The display stands none while
        // the edit is open (the duplication is out), the Enter stands the
        // soft break (the raw \n — no commit), the close (the blur / the
        // session's teardown) commits the draft in one updateRow, the
        // Escape cancels (no write).
        content = editing && isText ? null : <CellDisplay text={empty ? "" : String(value)} />;
    }
  }

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
      setTextDraft(rawValue);
    }
    // The datetime's drafts stand from the value at the open (the double
    // press is the session's single entry; the mid-session value changes
    // stand the draft untouched until the close commits).
    if (isDateTime) {
      setDraftDate(dateValue !== null ? dateOnly(dateValue) : null);
      setDraftTime(dateValue !== null && hasTime(dateValue) ? format(dateValue, "HH:mm:ss") : null);
    }
    onEditStart();
  };
  const cell = (
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
      onClick={onCellClick}
      onDoubleClick={onCellDoubleClick}
    >
      {content}
    </div>
  );
  if (isText) {
    // The multi-line text's edit stand (the text's cell): the double press
    // opens the floating editor over the cell (the Baserow's stand — the
    // portaled layer: the editor's top edge stands a few px over the
    // cell's top edge, the width stands the cell's, the 6-row's box stands
    // over the rows below — the scroller's clip is out, the rows stand no
    // shift). The opaque stand (the popover's background) keeps the
    // covered rows out of the sight. The Enter stands the soft break (the
    // raw \n — no commit), the close (the real blur / the outside press /
    // the session's teardown) commits the draft in one updateRow, the
    // Escape cancels (no write — the content's onEscapeKeyDown keeps the
    // radix's own close commit out).
    const multiOnOpenChange = (open: boolean) => {
      if (!open) {
        // The popover's own close (the real blur / the outside press)
        // commits the draft over its own stand; the session's teardown
        // (the other cell's / the outside press over the grid's pointer
        // model) commits over the teardown's effect — the settled ref
        // keeps the repeat commit a no-write.
        if (!textCancelledRef.current) {
          textSettledRef.current = true;
          commitTextDraft();
        }
        onEditEnd();
      }
    };
    const onMultiChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => setTextDraft(event.target.value);
    const onMultiKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Escape") cancelTextDraft();
    };

    return (
      <Popover open={editing} onOpenChange={multiOnOpenChange}>
        <PopoverTrigger asChild>{cell}</PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="start"
          // The editor's top edge stands the cell's top edge over (the box
          // opens over the row's top): the cell's 32px's height + the 8px's
          // stand, the negative offset over the anchor's bottom edge.
          sideOffset={-40}
          onEscapeKeyDown={preventDefault}
          className="w-(--radix-popover-trigger-width) rounded-md border border-border bg-popover p-0 shadow-md ring-0"
        >
          <Textarea
            data-slot="docblocks/database-cell-multiline"
            ref={multiLineRefCallback}
            rows={6}
            className="resize-none scrollbar-thin [scrollbar-color:var(--border)_transparent] overflow-y-auto border-border bg-transparent px-2.75 py-1.75 shadow-none select-text focus-visible:ring-0 md:text-base"
            value={textDraft ?? ""}
            onChange={onMultiChange}
            onBlur={onEditEnd}
            onKeyDown={onMultiKeyDown}
          />
        </PopoverContent>
      </Popover>
    );
  }
  return cell;
}

export { DatabaseCell };
