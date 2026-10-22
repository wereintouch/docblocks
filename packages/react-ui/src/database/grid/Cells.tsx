/** The grid's cell renderers: the row menu track, the edit input, the
 * read-only display and the cell itself (the column annotation's editor). */
import { format } from "date-fns";

import { useEffect, useRef, useState } from "react";
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";

import { Calendar } from "../../shared/ui/Calendar";
import { Checkbox } from "../../shared/ui/Checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../shared/ui/DropdownMenu";
import { Popover, PopoverContent, PopoverTrigger } from "../../shared/ui/Popover";
import { Select, SelectContent, SelectItem, SelectTrigger } from "../../shared/ui/Select";
import { Separator } from "../../shared/ui/Separator";
import { TimeSegments } from "../../shared/ui/TimeSegments";
import { cn } from "../../shared/ui/cn";
import { Ellipsis } from "../../shared/ui/icons";
import type { BridgeColumn, BridgeColumnAnnotation } from "../bridge";
import { columnAnnotation, parseCellValue } from "../bridge";
import { formatNumberValue } from "../number-format";
import type { DatabaseTableRow } from "../use-database-table";
import {
  CELL_INPUT,
  CELL_SELECTED,
  CELL_SELECTED_MULTI,
  CELL_WRAP,
  CHECKBOX_TOGGLE_GUARD_MS,
  EMPTY_CELL_OPTION,
} from "./models";
import {
  cellKeyOf,
  dateOnly,
  dateTimeLabel,
  hasTime,
  numberDisplayAttrs,
  numberStepFor,
  parseCellDateTime,
} from "./utils";

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
          // The unchanged value stands no commit (no bridge call, no
          // refetch, no no-op undo entry) — the blur just closes the
          // session.
          const unchanged =
            result.value === null
              ? value === undefined || value === null
              : value !== undefined && value !== null && value === result.value;
          if (!unchanged) onCommit(result.value);
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
  dragShifted,
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
    dragDx !== 0
      ? {
          transform: `translateX(${dragDx}px)`,
          position: "relative" as const,
          zIndex: dragShifted ? undefined : 10,
          transition: dragShifted ? "transform 120ms ease-out" : undefined,
        }
      : undefined;
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
                closeCommittedRef.current = true;
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
                onSelect={(day) => {
                  // The day-picker's same-day toggle (the undefined stand)
                  // resets no draft date: the datetime's commit is deferred
                  // to the close, so the toggle would clear the draft date
                  // and lose the typed time (the clear stand is the date
                  // cell's immediate-commit contract only).
                  if (day === undefined || day === null) return;
                  setDraftDate(dateOnly(day));
                }}
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
        // The datetime's drafts stand from the value at the open (the double
        // press is the session's single entry; the mid-session value
        // changes stand the draft untouched until the close commits).
        if (isDateTime) {
          setDraftDate(dateValue !== null ? dateOnly(dateValue) : null);
          setDraftTime(dateValue !== null && hasTime(dateValue) ? format(dateValue, "HH:mm:ss") : null);
        }
        onEditStart();
      }}
    >
      {content}
    </div>
  );
}

export { CellDisplay, CellEditInput, DatabaseCell, RowMenuCell };
