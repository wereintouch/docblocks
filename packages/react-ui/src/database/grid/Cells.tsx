/** The grid's cell renderers: the row menu track, the edit input, the
 * read-only display and the cell itself (the column annotation's editor). */
import { format } from "date-fns";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";

import { Calendar } from "../../shared/ui/Calendar";
import { Checkbox } from "../../shared/ui/Checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../shared/ui/DropdownMenu";
import { Popover, PopoverContent, PopoverTrigger } from "../../shared/ui/Popover";
import { Separator } from "../../shared/ui/Separator";
import { TimeSegments } from "../../shared/ui/TimeSegments";
import { cn } from "../../shared/ui/cn";
import { Ellipsis } from "../../shared/ui/icons";
import type { BridgeColumn, BridgeColumnAnnotation } from "../bridge";
import { columnAnnotation, parseCellValue } from "../bridge";
import { formatNumberValue } from "../number-format";
import type { DatabaseTableRow } from "../use-database-table";
import { CELL_INPUT, CELL_SELECTED, CELL_SELECTED_MULTI, CELL_WRAP, CHECKBOX_TOGGLE_GUARD_MS } from "./constants";
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
  /** The number column's right align (the type's contract — the value and
   * the input's text stand the right edge). */
  alignRight?: boolean;
  onDraftChange: (draft: string) => void;
  /** The blur / the Enter — the session's end (the cell commits the draft). */
  onEnd: () => void;
  /** The Escape — the draft's cancel (the session closes, no write). */
  onCancel: () => void;
}
function CellEditInput({ draft, kind, min, step, alignRight, onDraftChange, onEnd, onCancel }: CellEditInputProps) {
  return (
    <input
      type={kind === "number" ? "number" : "text"}
      data-slot="docblocks/database-cell-input"
      autoFocus
      min={min}
      step={step}
      className={cn(CELL_INPUT, alignRight && "text-right")}
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
  alignRight,
  ...props
}: {
  text: string;
  /** The number column's right align (the type's contract — the value and
   * the overflow's ellipsis stand the right edge). */
  alignRight?: boolean;
} & React.ComponentPropsWithoutRef<"span"> & { ref?: React.Ref<HTMLSpanElement> }) {
  // The read-only display stands one line (no wrap): the overflowing text
  // ends with the ellipsis (the multi-ref's stand stands the right fade
  // instead — the `RefValueChips`' own stand, not this text's). The number's
  // stand is the right align (the column's type's contract — the overflow's
  // ellipsis stands the left edge over the right-aligned text, the
  // browser's own stand).
  return (
    <span
      data-slot="docblocks/database-cell-display"
      className={cn("block w-full truncate px-1 text-(length:--docblocks-font-size)", alignRight && "text-right")}
      {...props}
    >
      {text === "" ? null : text}
    </span>
  );
}
/** One option of the ref's picker / editor (the option's value + its
 *  display label — the enum's option label, the row-link's resolved
 *  display; the enum's option's chip color — the `color` column's hex,
 *  the absent stand stands the neutral chip). */
interface RefOption {
  value: string;
  label: string;
  color?: string;
}
/** The chip's ink (the option's colors stand the pastel data — the dark
 *  ink stands legible on them over both themes). */
const OPTION_CHIP_INK = "#262626";
/** The picker's content's width's clamp: the cell's width's floor, the
 *  widest option's width's drive, the 220 px's ceiling (the option's
 *  ellipsis over the ceiling's stand). */
const PICKER_MAX_WIDTH_PX = 220;
/** The picker's width's chrome over the widest label (the row's px-2 +
 *  the chip's px-2 + the content's p-2 — the 16 px × 3); the multi's
 *  stand adds the checkbox's size-4 + the row's gap-2. */
const PICKER_CHROME_SINGLE_PX = 48;
const PICKER_CHROME_MULTI_PX = 72;
/** The option's label's measurement (the row's `text-sm`'s stand): the
 *  probe reads the label's width over the popover content's own font
 *  (the portaled content stands the body's font, not the editor's). */
function measureOptionLabelPx(label: string, fontFamily: string): number {
  const probe = document.createElement("span");
  probe.style.cssText = `position:fixed;left:-9999px;top:0;visibility:hidden;white-space:nowrap;font-size:14px;font-family:${fontFamily};`;
  probe.textContent = label;
  document.body.appendChild(probe);
  const width = probe.offsetWidth;
  probe.remove();
  return width;
}
/** The picker's content's width's clamp (the min = the cell's width, the
 *  widest option's drive, the 220 px's ceiling): measured over the
 *  content's mount (the font's read stands the portaled content's own
 *  computed stand). */
function usePickerWidthPx(
  open: boolean,
  trigger: HTMLElement | null,
  labels: readonly string[],
  multi: boolean
): number | undefined {
  const [width, setWidth] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!open || trigger === null) {
      setWidth(undefined);
      return;
    }
    const cellWidth = trigger.getBoundingClientRect().width;
    const fontFamily = getComputedStyle(trigger).fontFamily;
    const widest = labels.reduce((max, label) => Math.max(max, measureOptionLabelPx(label, fontFamily)), 0);
    const chrome = multi ? PICKER_CHROME_MULTI_PX : PICKER_CHROME_SINGLE_PX;
    setWidth(Math.min(PICKER_MAX_WIDTH_PX, Math.max(cellWidth, widest + chrome)));
  }, [open, trigger, labels, multi]);
  return width;
}
/**
 * The many value's chips stand (the multi-enum / the row-links): the train
 * of the option labels over the cell (the joined text's stand is out —
 * the single line, the overflow's clip over the cell's stand). The chip
 * stands the option's color's background (the data — the inline stand,
 * the neutral chip over the absent color). The empty stand stands none
 * (the cell's background only).
 */
function RefValueChips({ values, options, fade }: { values: string[]; options: RefOption[]; fade?: boolean }) {
  // The many value's stand (the multi's): the overflowing train's right edge
  // stands the fade (the `data-fade`'s mask — the chips clip without the
  // ellipsis); the chip stands its text's natural width (the shrink stands
  // none — the train overflows and the fade stands, the chip's text never
  // compresses). The single's stand (the fade stands none) keeps the chip's
  // ellipsis over the long label (the text's stand).
  if (values.length === 0) return null;
  return (
    <span
      data-slot="docblocks/database-ref-chips"
      data-fade={fade ? "true" : undefined}
      className="flex w-full flex-nowrap items-center gap-1 overflow-hidden px-1 text-(length:--docblocks-font-size)"
    >
      {values.map((value) => {
        const option = options.find((entry) => entry.value === value);
        return (
          <span
            key={value}
            data-slot="docblocks/database-ref-chip"
            data-option-value={value}
            style={option?.color !== undefined ? { backgroundColor: option.color, color: OPTION_CHIP_INK } : undefined}
            className={cn(
              "overflow-hidden rounded-(--docblocks-radius) px-1.5 leading-5 whitespace-nowrap",
              fade ? "shrink-0" : "max-w-full shrink text-ellipsis",
              option?.color === undefined && "bg-muted"
            )}
          >
            {option?.label ?? value}
          </span>
        );
      })}
    </span>
  );
}
/** The shared option picker's list (the single's / the multi's): the
 *  search's row (the autofocus stand over the open), the empty's option
 *  (the single's clear stand — the multi stands the toggles only), and
 *  the options over the configured's order (the row's chip stands the
 *  option's color). */
function OptionPickerList({
  options,
  multi,
  values,
  currentEmpty,
  tall,
  onPick,
  onToggle,
  onClear,
  onEditEnd,
}: {
  options: RefOption[];
  multi: boolean;
  /** The selected's values (the single's stand: the current's value over
   *  the array; the multi's stand: the committed's array). */
  values: string[];
  /** The single's empty's stand (the cell stands no value): the clear's
   *  row stands the selected's background (the current's state's stand). */
  currentEmpty?: boolean;
  /** The overflow's popover's stand (the list's height's stretch — the
   *  values' full's stand over the scroll's inner stand). */
  tall?: boolean;
  onPick: (value: string) => void;
  onToggle: (value: string) => void;
  onClear?: () => void;
  onEditEnd: () => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const filtered = needle === "" ? options : options.filter((option) => option.label.toLowerCase().includes(needle));
  return (
    <div className="flex flex-col gap-2">
      <input
        type="search"
        data-slot="docblocks/database-enum-picker-search"
        autoFocus
        placeholder="Search options"
        className="
          h-7 cursor-text rounded-md border border-border bg-transparent px-2 text-xs text-foreground outline-none
          focus:bg-muted/40
        "
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div
        data-slot="docblocks/database-enum-picker-list"
        className={cn("overflow-y-auto", tall ? "max-h-80" : "max-h-48")}
      >
        <div className="flex flex-col gap-1">
          {onClear !== undefined && (
            <button
              type="button"
              data-slot="docblocks/database-enum-picker-clear"
              className={cn(
                "block w-full cursor-pointer rounded-(--docblocks-radius) px-2 py-1.5 text-left text-sm",
                "text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground",
                currentEmpty && "bg-muted text-foreground"
              )}
              onClick={() => {
                onClear();
                onEditEnd();
              }}
            >
              —
            </button>
          )}
          {filtered.map((option) => (
            <div
              key={option.value}
              data-slot={multi ? "docblocks/database-ref-multi-option" : "docblocks/database-enum-picker-row"}
              data-option-value={option.value}
              data-state={multi ? (values.includes(option.value) ? "checked" : "unchecked") : undefined}
              role={multi ? undefined : "button"}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-(--docblocks-radius) px-2 py-1.5 text-sm",
                "text-foreground hover:bg-accent",
                values.includes(option.value) && "bg-muted"
              )}
              onClick={() => {
                if (multi) onToggle(option.value);
                else {
                  onPick(option.value);
                  onEditEnd();
                }
              }}
            >
              {multi && (
                <Checkbox
                  checked={values.includes(option.value)}
                  onCheckedChange={() => undefined}
                  className="pointer-events-none"
                />
              )}
              <span
                style={
                  option.color !== undefined ? { backgroundColor: option.color, color: OPTION_CHIP_INK } : undefined
                }
                className={cn(
                  "max-w-full shrink truncate rounded-(--docblocks-radius) px-2 leading-5",
                  option.color === undefined && "bg-muted"
                )}
              >
                {option.label}
              </span>
            </div>
          ))}
          {filtered.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No options.</div>}
        </div>
      </div>
    </div>
  );
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
/**
 * The enum column's many-cardinality editor (the multi-enum): the popover's
 * option list over the cell's width (the search's row, the option's chip +
 * the check over the selected); the press over the option stands the
 * immediate toggle (one `updateRow` per option — the draft stands none,
 * so the external teardown loses nothing).
 */
function RefMultiEditor({ values, options, onCommit, onEditEnd }: RefMultiEditorProps) {
  const toggle = (option: RefOption, include: boolean) => {
    const next = new Set(values);
    if (include) next.add(option.value);
    else next.delete(option.value);
    onCommit([...next]);
  };
  const [trigger, setTrigger] = useState<HTMLSpanElement | null>(null);
  const optionLabels = useMemo(() => options.map((option) => option.label), [options]);
  // The width's clamp (the cell's floor, the widest option's drive, the
  // 220 px's ceiling) over the content's font's stand.
  const width = usePickerWidthPx(true, trigger, optionLabels, true);
  // The overflow's stand (the clipped's train): the list's height's stretch
  // (the values' full's stand over the scroll's inner stand).
  const [tall, setTall] = useState(false);
  useEffect(() => {
    const chips = trigger?.querySelector<HTMLElement>('[data-slot="docblocks/database-ref-chips"]');
    setTall(chips != null && chips.scrollWidth > chips.clientWidth + 1);
  }, [trigger]);
  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) onEditEnd();
      }}
    >
      <PopoverTrigger asChild>
        <span
          ref={setTrigger}
          data-slot="docblocks/database-ref-multi-trigger"
          className="pointer-events-none block w-full text-(length:--docblocks-font-size)"
        >
          <RefValueChips values={values} options={options} fade />
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        style={width !== undefined ? { width: `${width}px` } : undefined}
        className="flex w-(--radix-popover-trigger-width) flex-col gap-1 p-2"
      >
        <OptionPickerList
          options={options}
          multi
          values={values}
          tall={tall}
          onPick={() => undefined}
          onToggle={(value) => {
            const option = options.find((entry) => entry.value === value);
            if (option !== undefined) toggle(option, !values.includes(value));
          }}
          onEditEnd={onEditEnd}
        />
      </PopoverContent>
    </Popover>
  );
}
interface EnumPickerProps {
  /** The options (the configured's order — the picker's list order). */
  options: RefOption[];
  /** The current value (the option's row id or the empty stand). */
  current: string | null;
  /** The session stand (the grid's edit session). */
  open: boolean;
  onPick: (value: string) => void;
  /** The empty's option (the clear → the null's commit). */
  onClear: () => void;
  onEditEnd: () => void;
}
/**
 * The enum column's single-cardinality picker: the popover's option list
 * over the cell's width (the search's row, the empty's clear option, the
 * options over the configured's order). The empty cell stands the cell's
 * background only (the trigger's box is out — the chip stands the value).
 * The one press stands the cell's select (the grid's contract), the second
 * press / the double press stands the list (the `open`'s session stand).
 */
function EnumPicker({ options, current, open, onPick, onClear, onEditEnd }: EnumPickerProps) {
  const [trigger, setTrigger] = useState<HTMLSpanElement | null>(null);
  const optionLabels = useMemo(() => options.map((option) => option.label), [options]);
  // The width's clamp (the cell's floor, the widest option's drive, the
  // 220 px's ceiling) over the content's font's stand.
  const width = usePickerWidthPx(open, trigger, optionLabels, false);
  // The overflow's stand (the clipped's chip): the list's height's stretch
  // (the value's full's stand over the scroll's inner stand).
  const [tall, setTall] = useState(false);
  useEffect(() => {
    const chips = trigger?.querySelector<HTMLElement>('[data-slot="docblocks/database-ref-chips"]');
    setTall(open && chips != null && chips.scrollWidth > chips.clientWidth + 1);
  }, [open, trigger]);
  const currentValues = current === null ? [] : [current];
  return (
    <Popover
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onEditEnd();
      }}
    >
      <PopoverTrigger asChild>
        <span
          ref={setTrigger}
          data-slot="docblocks/database-enum-picker-trigger"
          className="pointer-events-none block w-full px-1 text-(length:--docblocks-font-size)"
        >
          <RefValueChips values={currentValues} options={options} />
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        style={width !== undefined ? { width: `${width}px` } : undefined}
        className="flex w-(--radix-popover-trigger-width) flex-col gap-1 p-2"
      >
        <OptionPickerList
          options={options}
          multi={false}
          values={currentValues}
          currentEmpty={current === null}
          tall={tall}
          onPick={onPick}
          onToggle={() => undefined}
          onClear={onClear}
          onEditEnd={onEditEnd}
        />
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
          className="pointer-events-none block w-full px-1 text-(length:--docblocks-font-size)"
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
              "flex w-full items-center justify-center px-1",
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
          <EnumPicker
            options={refOptions}
            current={value === undefined || value === null ? null : String(value)}
            open={editing}
            onPick={(next) => onChange(next)}
            onClear={() => onChange(null)}
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
            onClear={() => onChange(null)}
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
      onClick={(event) => {
        // The enum's overflow's stand (the value's display clipped — the
        // ellipsis / the fade's mask): the press stands the picker's
        // popover (the value's full's stand) over the selection's stand
        // (the non-overflowing's value keeps the press model — the double
        // press is the picker's stand). The single's chip truncates (the
        // clip's measure stands the chip's own box); the multi's train
        // overflows (the clip's measure stands the train's container).
        // The open stands the click (the popover's mount over the
        // in-flight press stands the radix's outside-dismiss).
        if (annotation.valueInput !== "enum") return;
        const prober = isManyRef
          ? event.currentTarget.querySelector<HTMLElement>('[data-slot="docblocks/database-ref-chips"]')
          : event.currentTarget.querySelector<HTMLElement>('[data-slot="docblocks/database-ref-chip"]');
        if (prober !== null && prober.scrollWidth > prober.clientWidth + 1) {
          onEditStart();
        }
      }}
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
    return (
      <Popover
        open={editing}
        onOpenChange={(open) => {
          if (!open) {
            // The popover's own close (the real blur / the outside press)
            // commits the draft over its own stand; the session's teardown
            // (the other cell's / the outside press over the grid's
            // pointer model) commits over the teardown's effect — the
            // settled ref keeps the repeat commit a no-write.
            if (!textCancelledRef.current) {
              textSettledRef.current = true;
              commitTextDraft();
            }
            onEditEnd();
          }
        }}
      >
        <PopoverTrigger asChild>{cell}</PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="start"
          // The editor's top edge stands the cell's top edge over (the box
          // opens over the row's top): the cell's 32px's height + the 8px's
          // stand, the negative offset over the anchor's bottom edge.
          sideOffset={-40}
          onEscapeKeyDown={(event) => event.preventDefault()}
          className="w-(--radix-popover-trigger-width) rounded-md border border-border bg-popover p-0 shadow-md ring-0"
        >
          <textarea
            data-slot="docblocks/database-cell-multiline"
            ref={multiLineRefCallback}
            rows={6}
            className="
              box-border block w-full resize-none scrollbar-thin [scrollbar-color:var(--border)_transparent]
              overflow-y-auto bg-transparent px-2.75 py-1.75 text-base outline-none select-text
            "
            value={textDraft ?? ""}
            onChange={(event) => setTextDraft(event.target.value)}
            onBlur={onEditEnd}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                cancelTextDraft();
              }
            }}
          />
        </PopoverContent>
      </Popover>
    );
  }
  return cell;
}

export { CellDisplay, CellEditInput, DatabaseCell, RowMenuCell };
