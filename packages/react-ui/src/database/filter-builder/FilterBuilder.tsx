/**
 * The recursive and/or filter editor: the top-level FilterBuilder renders a
 * FilterGroup (the logic selector + the gutter body), which renders the
 * condition rows (FilterConditionRow) + the nested groups (FilterGroupCard);
 * each condition's value is a ValueInput over the column's annotation.
 * Every body item draws its share of the group's vertical connector line
 * (the thin left line that binds the conditions and the groups into one
 * tree — the last item stops the line at its tick).
 */
import { useTranslation } from "react-i18next";

import type { DatabaseFilterPayload } from "docblocks-core";

import { BareSelect, Button, Input } from "../../shared/ui";
import { SegmentSelector } from "../../shared/ui/SegmentSelector";
import type { SegmentOption } from "../../shared/ui/SegmentSelector";
import { cn } from "../../shared/ui/cn";
import { X } from "../../shared/ui/icons";
import { columnAnnotation } from "../bridge";
import type { BridgeColumn } from "../bridge";
import { refEntryKey } from "../grid/use-ref-tables";
import type { RefTableDataMap } from "../grid/use-ref-tables";
import { FILTER_MAX_DEPTH, emptyFilter } from "./utils";

interface FilterBuilderProps {
  /** The payload being edited; null = the empty filter. */
  value: DatabaseFilterPayload | null;
  /** The columns (the annotation source). */
  columns: BridgeColumn[];
  /** The draft change (the parent keeps the draft until Apply). */
  onChange: (payload: DatabaseFilterPayload) => void;
  /** The ref tables' data (the enum's dict options + the row-link's row
   *  displays — the ref value inputs render from it). */
  refTableData?: RefTableDataMap;
}

const FILTER_LOGIC_VALUES = ["and", "or"] as const;

function FilterBuilder({ value, columns, onChange, refTableData }: FilterBuilderProps) {
  const { t } = useTranslation("database");
  const payload = value ?? emptyFilter();
  // The logic's options stand the catalog's labels (the pill's labels — the
  // hard-coded's "AND" / "OR"'s stand stands the en's default only).
  const logicOptions: SegmentOption<(typeof FILTER_LOGIC_VALUES)[number]>[] = FILTER_LOGIC_VALUES.map((entry) => ({
    value: entry,
    label: t(`filter.${entry}`),
  }));
  return (
    <div data-slot="docblocks/filter-builder" className="flex max-h-80 flex-col gap-2 overflow-y-auto">
      {columns.length === 0 ? (
        <div data-slot="docblocks/filter-empty" className="text-sm text-muted-foreground">
          {t("filter.empty")}
        </div>
      ) : (
        <FilterGroup
          payload={payload}
          columns={columns}
          depth={0}
          logicOptions={logicOptions}
          onChange={onChange}
          refTableData={refTableData}
        />
      )}
    </div>
  );
}

interface FilterGroupProps {
  payload: DatabaseFilterPayload;
  columns: BridgeColumn[];
  depth: number;
  logicOptions: SegmentOption<"and" | "or">[];
  onChange: (payload: DatabaseFilterPayload) => void;
  refTableData?: RefTableDataMap;
}

function FilterGroup({ payload, columns, depth, logicOptions, onChange, refTableData }: FilterGroupProps) {
  const { t } = useTranslation("database");
  const groups = payload.groups ?? [];
  const setLogic = (logic: "and" | "or") => onChange({ ...payload, logic });
  const setCondition = (index: number, condition: DatabaseFilterPayload["conditions"][number]) =>
    onChange({ ...payload, conditions: payload.conditions.map((entry, at) => (at === index ? condition : entry)) });
  const removeCondition = (index: number) =>
    onChange({ ...payload, conditions: payload.conditions.filter((_, at) => at !== index) });
  const setGroup = (index: number, group: DatabaseFilterPayload) =>
    onChange({ ...payload, groups: groups.map((entry, at) => (at === index ? group : entry)) });
  const removeGroup = (index: number) => onChange({ ...payload, groups: groups.filter((_, at) => at !== index) });

  const addGroup = () => onChange({ ...payload, groups: [...groups, emptyFilter()] });
  // The "+ Condition" press: the group's first column as a new condition
  // over its first operator (the group's column set stands the options).
  const addCondition = () => {
    const column = columns[0];
    if (column === undefined) return;
    const firstOperator = columnAnnotation(column).operators[0] ?? "is";
    onChange({ ...payload, conditions: [...payload.conditions, { columnId: column.id, op: firstOperator }] });
  };
  const onLogicChange = (logic: "and" | "or") => {
    if (logic !== payload.logic) setLogic(logic);
  };
  // The per-item stands over the group's list handlers (the map's index
  // stand).
  const conditionChange = (index: number) => (next: DatabaseFilterPayload["conditions"][number]) =>
    setCondition(index, next);
  const conditionRemove = (index: number) => () => removeCondition(index);
  const removeGroupAt = (index: number) => () => removeGroup(index);
  const groupChange = (index: number) => (next: DatabaseFilterPayload) => setGroup(index, next);
  // The connector line's end: the condition's line runs past the row gap
  // for every condition but the last item of the body (a group stands after
  // all the conditions); the last item stops the line at its tick (a bend,
  // not a dead-end).
  const isLastCondition = (index: number) => index === payload.conditions.length - 1 && groups.length === 0;
  const isLastGroup = (index: number) => index === groups.length - 1;

  return (
    <div data-slot="docblocks/filter-group" data-logic={payload.logic} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <SegmentSelector
          options={logicOptions}
          value={payload.logic}
          onChange={onLogicChange}
          ariaLabel={t("filter.logic")}
          slot="docblocks/filter-logic"
          pillSlot="docblocks/filter-logic-pill"
          buttonAttrName="filter-logic"
          size="text"
          // The pill's prominent fill's stand (the `primary` token — the
          // white's stand over the neutral's dark theme, the consumer's
          // theme's parity).
          pillTheme="primary"
        />
        <span className="text-xs text-muted-foreground">
          {payload.logic === "and" ? t("filter.matchAll") : t("filter.matchAny")}
        </span>
      </div>

      <div className="flex flex-col gap-2 pl-5">
        {payload.conditions.map((condition, index) => (
          <FilterConditionRow
            key={index}
            condition={condition}
            columns={columns}
            onChange={conditionChange(index)}
            onRemove={conditionRemove(index)}
            refTableData={refTableData}
            isLast={isLastCondition(index)}
          />
        ))}

        {groups.map((group, index) => (
          <FilterGroupCard
            key={index}
            index={index}
            payload={group}
            columns={columns}
            depth={depth + 1}
            logicOptions={logicOptions}
            onChange={groupChange(index)}
            onRemove={removeGroupAt(index)}
            refTableData={refTableData}
            isLast={isLastGroup(index)}
          />
        ))}
      </div>

      <div className="flex gap-2 pl-5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-slot="docblocks/filter-add-condition"
          onClick={addCondition}
        >
          {t("filter.condition")}
        </Button>
        {depth < FILTER_MAX_DEPTH && (
          <Button type="button" variant="outline" size="sm" data-slot="docblocks/filter-add-group" onClick={addGroup}>
            {t("filter.group")}
          </Button>
        )}
      </div>
    </div>
  );
}

interface FilterConditionRowProps {
  condition: DatabaseFilterPayload["conditions"][number];
  columns: BridgeColumn[];
  onChange: (condition: DatabaseFilterPayload["conditions"][number]) => void;
  onRemove: () => void;
  refTableData?: RefTableDataMap;
  /** The connector line's end (the body's last item stops the line at its
   *  tick). */
  isLast: boolean;
}

function FilterConditionRow({ condition, columns, onChange, onRemove, refTableData, isLast }: FilterConditionRowProps) {
  const { t } = useTranslation("database");
  const column = columns.find((entry) => entry.id === condition.columnId) ?? columns[0];
  if (column === undefined) return null;
  const annotation = columnAnnotation(column);
  const firstOperator = annotation.operators[0] ?? "is";
  const operator = annotation.operators.includes(condition.op) ? condition.op : firstOperator;
  const needsValue = !annotation.valueless.has(operator);
  const onColumnChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextColumn = columns.find((entry) => entry.id === event.target.value);
    if (nextColumn === undefined) return;
    onChange({
      columnId: nextColumn.id,
      op: columnAnnotation(nextColumn).operators[0] ?? "is",
      value: undefined,
    });
  };
  const onOperatorChange = (event: React.ChangeEvent<HTMLSelectElement>) =>
    onChange({ ...condition, op: event.target.value, value: undefined });
  const onValueChange = (value: unknown) => onChange({ ...condition, op: operator, value });

  return (
    <div
      data-slot="docblocks/filter-condition"
      data-column-id={condition.columnId}
      data-op={operator}
      className="relative flex items-center gap-2"
    >
      {/* Connector: the horizontal tick at the control line's center (the
       * row stands the h-8 control), and the row's share of the vertical
       * group line — running past the row gap to the next row for all but
       * the last row, which stops the line at its tick. */}
      <span aria-hidden className="absolute bottom-4 -left-5 h-px w-5 bg-border" />
      <span aria-hidden className={cn("absolute top-0 -left-5 w-px bg-border", isLast ? "bottom-4" : "-bottom-2")} />
      {/* The field's select is capped (a very long column's name stands
       * truncated, not a row overflow over the popover's max width). */}
      <BareSelect
        data-slot="docblocks/filter-column"
        className="max-w-60 min-w-35"
        value={column.id}
        onChange={onColumnChange}
      >
        {columns.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name}
          </option>
        ))}
      </BareSelect>
      <BareSelect data-slot="docblocks/filter-operator" value={operator} onChange={onOperatorChange}>
        {annotation.operators.map((entry) => (
          <option key={entry} value={entry}>
            {entry}
          </option>
        ))}
      </BareSelect>
      {needsValue && (
        <ValueInput
          column={column}
          operator={operator}
          value={condition.value}
          onChange={onValueChange}
          refTableData={refTableData}
        />
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        data-slot="docblocks/filter-remove-condition"
        aria-label={t("filter.removeCondition")}
        className="size-8 shrink-0"
        onClick={onRemove}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

interface FilterGroupCardProps {
  /** The group's ordinal (the header's number). */
  index: number;
  payload: DatabaseFilterPayload;
  columns: BridgeColumn[];
  depth: number;
  logicOptions: SegmentOption<"and" | "or">[];
  onChange: (payload: DatabaseFilterPayload) => void;
  onRemove: () => void;
  refTableData?: RefTableDataMap;
  /** The connector line's end (the body's last item stops the line at its
   *  tick). */
  isLast: boolean;
}

/** The nested filter group: the bordered card with the ordinal header and
 *  the remove, and the recursive `FilterGroup` inside. Draws its share of
 *  the parent group's connector line (the border-less wrapper is the line's
 *  positioning context). */
function FilterGroupCard({
  index,
  payload,
  columns,
  depth,
  logicOptions,
  onChange,
  onRemove,
  refTableData,
  isLast,
}: FilterGroupCardProps) {
  const { t } = useTranslation("database");

  return (
    <div data-slot="docblocks/filter-nested" className="relative">
      {/* Connector: the horizontal tick at the header line's center (p-2 +
       * the h-8 header / 2), and the card's share of the parent group's
       * line — running past the row gap to the next row for all but the
       * last card, which stops the line at the header tick. The card's
       * nested group draws its own line further in. */}
      <span aria-hidden className="absolute top-6 -left-5 h-px w-5 bg-border" />
      <span aria-hidden className={cn("absolute top-0 -left-5 w-px bg-border", isLast ? "h-6" : "-bottom-2")} />
      <div className="flex flex-col gap-2 rounded-md border border-border p-2">
        <div className="flex items-center justify-between gap-2">
          <span data-slot="docblocks/filter-group-header" className="text-xs font-medium text-muted-foreground">
            {t("filter.groupHeader", { index: index + 1 })}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-slot="docblocks/filter-remove-group"
            aria-label={t("filter.removeGroup")}
            className="size-8 shrink-0"
            onClick={onRemove}
          >
            <X className="size-3.5" />
          </Button>
        </div>
        <FilterGroup
          payload={payload}
          columns={columns}
          depth={depth}
          logicOptions={logicOptions}
          onChange={onChange}
          refTableData={refTableData}
        />
      </div>
    </div>
  );
}

interface ValueInputProps {
  column: BridgeColumn;
  operator: string;
  value: unknown;
  onChange: (value: unknown) => void;
  refTableData?: RefTableDataMap;
}

/** The value input per the annotation (the `in` / `not in` multi-value is a
 *  comma list). The input stands the row's leftover (the field / the
 *  operator take their content width, the value fills the rest — the
 *  single line's stand). */
function ValueInput({ column, operator, value, onChange, refTableData }: ValueInputProps) {
  const { t } = useTranslation("database");
  const multiValue = operator === "in" || operator === "not in";
  const annotation = columnAnnotation(column);
  const onMultiChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const parts = event.target.value
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    onChange(parts.length > 0 ? parts : undefined);
  };
  const onScalarChange = (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    onChange(event.target.value === "" ? undefined : event.target.value);
  const onNumberChange = (event: React.ChangeEvent<HTMLInputElement>) =>
    onChange(event.target.value === "" ? undefined : Number(event.target.value));
  const onBooleanChange = (event: React.ChangeEvent<HTMLSelectElement>) =>
    onChange(event.target.value === "" ? undefined : event.target.value === "true");

  if (multiValue) {
    const text = Array.isArray(value) ? value.join(", ") : value === undefined || value === null ? "" : String(value);
    return (
      <Input
        type="text"
        size="sm"
        data-slot="docblocks/filter-value"
        className="min-w-0 flex-1 border-input"
        placeholder={t("filter.valuePlaceholder")}
        value={text}
        onChange={onMultiChange}
      />
    );
  }
  switch (annotation.valueInput) {
    case "number":
      return (
        <Input
          type="number"
          size="sm"
          data-slot="docblocks/filter-value"
          className="min-w-0 flex-1 border-input"
          value={value === undefined || value === null ? "" : String(value)}
          onChange={onNumberChange}
        />
      );
    case "boolean":
      return (
        <BareSelect
          data-slot="docblocks/filter-value"
          className="min-w-0 flex-1"
          value={value === undefined || value === null ? "" : String(value)}
          onChange={onBooleanChange}
        >
          <option value="">—</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </BareSelect>
      );
    case "date":
      return (
        <Input
          type="date"
          size="sm"
          data-slot="docblocks/filter-value"
          className="min-w-0 flex-1 border-input"
          value={value === undefined || value === null ? "" : String(value)}
          onChange={onScalarChange}
        />
      );
    case "datetime":
      return (
        <Input
          type="datetime-local"
          size="sm"
          data-slot="docblocks/filter-value"
          className="min-w-0 flex-1 border-input"
          value={value === undefined || value === null ? "" : String(value)}
          onChange={onScalarChange}
        />
      );
    case "enum":
    case "row-link": {
      // The ref value stand (the select over the ref table's options /
      // rows — the many cardinality's `is` / `is not` take the SINGLE
      // value: the match stands over the containment in the cell's array).
      const refTable =
        column.refTableId !== undefined
          ? refTableData?.[refEntryKey({ tableId: column.refTableId, displayColumn: column.refDisplayColumn })]
          : undefined;
      const entries = refTable?.rowIds ?? [];
      return (
        <BareSelect
          data-slot="docblocks/filter-value"
          className="min-w-0 flex-1"
          value={value === undefined || value === null ? "" : String(value)}
          onChange={onScalarChange}
        >
          <option value="">—</option>
          {entries.map((entry) => (
            <option key={entry} value={entry}>
              {refTable !== undefined && refTable.displays[entry] !== undefined && refTable.displays[entry] !== ""
                ? refTable.displays[entry]
                : entry}
            </option>
          ))}
        </BareSelect>
      );
    }
    default:
      return (
        <Input
          type="text"
          size="sm"
          data-slot="docblocks/filter-value"
          className="min-w-0 flex-1 border-input"
          value={value === undefined || value === null ? "" : String(value)}
          onChange={onScalarChange}
        />
      );
  }
}

export { FilterBuilder };
