/**
 * The cell's per-type's editors (the number's edit stand, the date /
 * datetime's pickers, the boolean's checkbox — the cell's content's stand
 * renders them over the value input's kind).
 */
import { format } from "date-fns";

import { Calendar } from "../../../shared/ui/Calendar";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "../../../shared/ui/Popover";
import { Separator } from "../../../shared/ui/Separator";
import { TimeSegments } from "../../../shared/ui/TimeSegments";
import { cn } from "../../../shared/ui/cn";
import type { BridgeColumn } from "../../bridge";
import { formatNumberValue } from "../../number-format";
import { PICKER_SIDE_OFFSET_PX } from "../constants";
import { dateTimeLabel, numberDisplayAttrs, numberStepFor } from "../utils";
import { CellDisplay } from "./CellDisplay";
import { CellEditInput } from "./CellEditInput";

interface NumberCellProps {
  column: BridgeColumn;
  empty: boolean;
  editing: boolean;
  rawValue: string;
  textDraft: string | null;
  setTextDraft: (draft: string) => void;
  onEnd: () => void;
  onCancel: () => void;
}

function NumberCell({ column, empty, editing, rawValue, textDraft, setTextDraft, onEnd, onCancel }: NumberCellProps) {
  // The display stands the column's format (the prefix / the
  // thousands / the suffix frame the value — the raw number stays
  // the data; a non-numeric stand (the consumer's odd value) keeps
  // the raw string).
  const numeric = rawValue === "" ? null : Number(rawValue);
  const display =
    numeric !== null && Number.isFinite(numeric) ? formatNumberValue(numeric, numberDisplayAttrs(column)) : rawValue;
  return editing ? (
    <CellEditInput
      draft={textDraft ?? ""}
      kind="number"
      min={column.allowNegative === false ? 0 : undefined}
      step={numberStepFor(column)}
      onDraftChange={setTextDraft}
      onEnd={onEnd}
      onCancel={onCancel}
      alignRight
    />
  ) : (
    <CellDisplay text={empty ? "" : display} alignRight />
  );
}

interface DateCellProps {
  dateValue: Date | null;
  editing: boolean;
  dateOnOpenChange: (open: boolean) => void;
  onDateSelect: (day: Date | undefined) => void;
}

function DateCell({ dateValue, editing, dateOnOpenChange, onDateSelect }: DateCellProps) {
  return (
    <Popover open={editing} onOpenChange={dateOnOpenChange}>
      <PopoverTrigger asChild>
        <CellDisplay text={dateValue !== null ? format(dateValue, "dd.MM.yyyy") : ""} />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={PICKER_SIDE_OFFSET_PX} className="w-auto p-0">
        <Calendar
          mode="single"
          selected={dateValue ?? undefined}
          {...(dateValue !== null ? { defaultMonth: dateValue } : {})}
          onSelect={onDateSelect}
        />
      </PopoverContent>
    </Popover>
  );
}

interface DateTimeCellProps {
  rowId: string;
  column: BridgeColumn;
  dateValue: Date | null;
  draftDate: Date | null;
  draftTime: string | null;
  editing: boolean;
  setDraftTime: (time: string | null) => void;
  onDateTimeDaySelect: (day: Date | undefined) => void;
  dateTimeOnOpenChange: (open: boolean) => void;
  onDateTimePopoverKeyDown: (event: React.KeyboardEvent) => void;
  cancelDateTimeDraft: () => void;
}

function DateTimeCell({
  rowId,
  column,
  dateValue,
  draftDate,
  draftTime,
  editing,
  setDraftTime,
  onDateTimeDaySelect,
  dateTimeOnOpenChange,
  onDateTimePopoverKeyDown,
  cancelDateTimeDraft,
}: DateTimeCellProps) {
  return (
    <Popover open={editing} onOpenChange={dateTimeOnOpenChange}>
      <PopoverTrigger asChild>
        <CellDisplay text={dateValue !== null ? dateTimeLabel(dateValue) : ""} />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={PICKER_SIDE_OFFSET_PX}
        className="w-auto p-0"
        onKeyDown={onDateTimePopoverKeyDown}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          cancelDateTimeDraft();
        }}
      >
        <Calendar
          mode="single"
          selected={draftDate ?? undefined}
          defaultMonth={dateValue ?? undefined}
          onSelect={onDateTimeDaySelect}
        />
        <Separator />
        <div className="p-2">
          <TimeSegments id={`db-cell-time-${rowId}-${column.id}`} value={draftTime} onChange={setDraftTime} clearable />
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface BooleanCellProps {
  column: BridgeColumn;
  value: unknown;
  editing: boolean;
  singleSelected: boolean;
  onCheckboxPress: (event: React.MouseEvent<HTMLSpanElement>) => void;
  noOp: () => void;
}

function BooleanCell({ column, value, editing, singleSelected, onCheckboxPress, noOp }: BooleanCellProps) {
  // The checkbox's interactive stand: over the sole selection the
  // press over the checkbox is the toggle (the pointer cursor);
  // otherwise it stands pointer-transparent (the single press is the
  // cell selection, the double press is the toggle over the wrapper).
  const checkboxInteractive = singleSelected && !editing;
  return (
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
}

export { BooleanCell, DateCell, DateTimeCell, NumberCell };
