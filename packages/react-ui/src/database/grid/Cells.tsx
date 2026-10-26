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
import type { RefTableData } from "./use-ref-tables";
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
/** The cell's edit input (the text / the number): the dumb controlled
 * stand — the draft stands in the cell (the grid's session teardown — the
 * outside press, the other cell's press — drops the session before the
 * DOM's blur stands, so the commit must not depend on the blur: the cell
 * commits the draft on the teardown, like the datetime's close commit).
 * The Enter stands the blur (the commit path); the Escape cancels the
 * draft without a write. */
interface CellEditInputProps {
  draft: string;
  kind: "text" | "number";
  /** The number input's minimum (the non-negative column stands 0). */
  min?: number;
  /** The number input's step stand (the column's decimals). */
  step?: string;
  onDraftChange: (draft: string) => void;
  /** The blur / the Enter — the session's end (the cell commits the draft). */
  onEnd: () => void;
  /** The Escape — the draft's cancel (the session closes, no write). */
  onCancel: () => void;
}
function CellEditInput({ draft, kind, min, step, onDraftChange, onEnd, onCancel }: CellEditInputProps) {
  return (
    <input
      type={kind === "number" ? "number" : "text"}
      data-slot="docblocks/database-cell-input"
      autoFocus
      min={min}
      step={step}
      className={CELL_INPUT}
      value={draft}
      onChange={(event) => onDraftChange(event.target.value)}
      onBlur={onEnd}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
        if (event.key === "Escape") onCancel();
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
/** One option of the ref multi editor (the option's value + its display
 *  label — the enum's option label, the row-link's resolved display). */
interface RefOption {
  value: string;
  label: string;
}
interface RefMultiEditorProps {
  /** The current values (the committed array, string stand). */
  values: string[];
  options: RefOption[];
  /** The committed value stand (one `updateRow` per toggle — the draft
   *  stands none, so the external teardown loses nothing). */
  onCommit: (next: string[]) => void;
  onEditEnd: () => void;
}
/**
 * The ref column's many-cardinality editor (the multi-enum / the row
 * links): the popover's checkbox list over the options; the press over
 * the option stands the immediate toggle (one `updateRow` per option —
 * the draft stands none, so the external teardown loses nothing).
 */
function RefMultiEditor({ values, options, onCommit, onEditEnd }: RefMultiEditorProps) {
  const toggle = (option: RefOption, include: boolean) => {
    const next = new Set(values);
    if (include) next.add(option.value);
    else next.delete(option.value);
    onCommit([...next]);
  };
  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) onEditEnd();
      }}
    >
      <PopoverTrigger asChild>
        <span
          data-slot="docblocks/database-ref-multi-trigger"
          className="block w-full cursor-default px-1 text-(length:--docblocks-font-size)"
        >
          {values.length === 0 ? null : (
            <span className="line-clamp-1">
              {values.map((value) => options.find((entry) => entry.value === value)?.label ?? value).join(", ")}
            </span>
          )}
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} className="flex w-52 flex-col gap-1 p-2">
        {options.length === 0 ? (
          <div data-slot="docblocks/database-ref-multi-empty" className="text-xs text-muted-foreground">
            No options.
          </div>
        ) : (
          options.map((option) => (
            <label
              key={option.value}
              className="
                flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-foreground outline-none
                hover:bg-accent hover:text-accent-foreground
              "
            >
              <Checkbox
                data-slot="docblocks/database-ref-multi-option"
                data-option-value={option.value}
                checked={values.includes(option.value)}
                onCheckedChange={(checked) => toggle(option, checked === true)}
              />
              <span className="line-clamp-1">{option.label}</span>
            </label>
          ))
        )}
      </PopoverContent>
    </Popover>
  );
}
interface RowLinkPickerProps {
  /** The ref table's row ids (the picker's list). */
  rowIds: string[];
  /** The row displays (rowId → the display text; the join stands in the
   *  consumer backend). */
  displays: Record<string, string>;
  /** The current value (the row id or the empty stand). */
  current: string;
  /** The session stand (the grid's edit session). */
  open: boolean;
  onPick: (rowId: string) => void;
  onClear: () => void;
  onEditEnd: () => void;
}
/** The picker's list (the search + the rows): the component stands
 *  inside the popover content, so the search draft resets on the close
 *  (the content unmounts). */
function RowLinkPickerList({
  rowIds,
  displays,
  onPick,
  onClear,
  onEditEnd,
}: Omit<RowLinkPickerProps, "current" | "open">) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const filtered =
    needle === ""
      ? rowIds
      : rowIds.filter(
          (rowId) => (displays[rowId] ?? rowId).toLowerCase().includes(needle) || rowId.toLowerCase().includes(needle)
        );
  return (
    <div className="flex flex-col gap-2">
      <input
        type="search"
        data-slot="docblocks/database-row-picker-search"
        autoFocus
        placeholder="Search rows"
        className="
          h-7 cursor-text rounded-md border border-border bg-transparent px-2 text-xs text-foreground outline-none
          focus:bg-muted/40
        "
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="max-h-48 overflow-y-auto">
        <button
          type="button"
          data-slot="docblocks/database-row-picker-clear"
          className="
            block w-full cursor-pointer rounded-sm px-2 py-1.5 text-left text-sm text-muted-foreground outline-none
            hover:bg-accent hover:text-accent-foreground
          "
          onClick={() => {
            onClear();
            onEditEnd();
          }}
        >
          —
        </button>
        {filtered.map((rowId) => (
          <button
            key={rowId}
            type="button"
            data-slot="docblocks/database-row-picker-row"
            data-row-id={rowId}
            className="
              block w-full cursor-pointer truncate rounded-sm px-2 py-1.5 text-left text-sm text-foreground outline-none
              hover:bg-accent hover:text-accent-foreground
            "
            onClick={() => {
              onPick(rowId);
              onEditEnd();
            }}
          >
            {displays[rowId] ?? rowId}
          </button>
        ))}
      </div>
    </div>
  );
}
/**
 * The row-link cell's picker: the ref table's rows over the search (the
 * client-side filter over the loaded page). The pick commits the row id
 * (one `updateRow`); the `—` entry clears the link.
 */
function RowLinkPicker({ rowIds, displays, current, open, onPick, onClear, onEditEnd }: RowLinkPickerProps) {
  return (
    <Popover
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onEditEnd();
      }}
    >
      <PopoverTrigger asChild>
        <span
          data-slot="docblocks/database-row-picker-trigger"
          className="block w-full cursor-default px-1 text-(length:--docblocks-font-size)"
        >
          {current === "" ? null : <span className="line-clamp-1">{displays[current] ?? current}</span>}
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} data-slot="docblocks/database-row-picker" className="w-60 p-2">
        <RowLinkPickerList
          rowIds={rowIds}
          displays={displays}
          onPick={onPick}
          onClear={onClear}
          onEditEnd={onEditEnd}
        />
      </PopoverContent>
    </Popover>
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
  const empty = value === undefined || value === null || value === "";
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

  // The ref table's stand (the enum's dict options — the dict table's PK
  // IS the option label, so the row ids stand the options; the row-link's
  // displays — the dead row id keeps the raw stand, the lenient read).
  const refRowIds = refTableData?.rowIds ?? [];
  const refDisplays = refTableData?.displays ?? {};
  const refOptions: RefOption[] =
    column.refKind === "enum"
      ? refRowIds.map((rowId) => ({ value: rowId, label: rowId }))
      : refRowIds.map((rowId) => ({ value: rowId, label: refDisplays[rowId] ?? rowId }));

  let content: ReactNode;
  if (Array.isArray(value)) {
    // The many cardinality (the multi-enum / the row-links): the edit is
    // the popover's checkbox list (the toggle commits immediately — no
    // draft), the display stands the joined labels / displays (the
    // non-ref array keeps the raw join — the lenient stand).
    const refValues = value.map((item) => String(item));
    if (editing && column.refKind !== undefined) {
      content = <RefMultiEditor values={refValues} options={refOptions} onCommit={onChange} onEditEnd={onEditEnd} />;
    } else {
      const text =
        column.refKind === "row" ? refValues.map((item) => refDisplays[item] ?? item).join(", ") : refValues.join(", ");
      content = <CellDisplay text={text} />;
    }
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
            draft={textDraft ?? ""}
            kind="number"
            min={column.allowNegative === false ? 0 : undefined}
            step={numberStepFor(column)}
            onDraftChange={setTextDraft}
            onEnd={onEditEnd}
            onCancel={cancelTextDraft}
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
      case "enum":
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
                w-full cursor-default justify-start rounded-(--docblocks-radius) border-0 bg-transparent px-1
                text-(length:--docblocks-font-size) shadow-none outline-none
                data-[size=sm]:h-6
              "
            >
              <span className="line-clamp-1">{empty ? "" : String(value)}</span>
            </SelectTrigger>
            <SelectContent align="start" sideOffset={4}>
              <SelectItem value={EMPTY_CELL_OPTION}>—</SelectItem>
              {refRowIds.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
            onClear={() => onChange(null)}
            onEditEnd={onEditEnd}
          />
        );
        break;
      default:
        content = editing ? (
          <CellEditInput
            draft={textDraft ?? ""}
            kind="text"
            onDraftChange={setTextDraft}
            onEnd={onEditEnd}
            onCancel={cancelTextDraft}
          />
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
        // The text / number's draft stands from the value at the open (the
        // double press is the session's single entry; the mid-session
        // value changes stand the draft untouched until the close commits).
        if (isText || isNumber) {
          textCancelledRef.current = false;
          textSettledRef.current = false;
          setTextDraft(rawValue);
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
