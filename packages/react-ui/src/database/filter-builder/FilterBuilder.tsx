/**
 * The recursive and/or filter editor: the top-level FilterBuilder renders a
 * FilterGroup (the group card), which renders the condition rows
 * (FilterConditionRow) + the nested groups; each condition's value is a
 * ValueInput over the column's annotation.
 */
import type { DatabaseFilterPayload } from "docblocks-core";

import { BareSelect, Button, Input } from "../../shared/ui";
import { SegmentSelector } from "../../shared/ui/SegmentSelector";
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

/** The recursive and/or filter editor (the group card). */
const FILTER_LOGIC_OPTIONS = [
  { value: "and", label: "AND" },
  { value: "or", label: "OR" },
] as const;

function FilterBuilder({ value, columns, onChange, refTableData }: FilterBuilderProps) {
  const payload = value ?? emptyFilter();
  return (
    <div data-slot="docblocks/filter-builder" className="flex max-h-80 flex-col gap-2 overflow-y-auto">
      {columns.length === 0 ? (
        <div data-slot="docblocks/filter-empty" className="text-sm text-muted-foreground">
          No columns to filter on.
        </div>
      ) : (
        <FilterGroup payload={payload} columns={columns} depth={0} onChange={onChange} refTableData={refTableData} />
      )}
    </div>
  );
}

interface FilterGroupProps {
  payload: DatabaseFilterPayload;
  columns: BridgeColumn[];
  depth: number;
  onChange: (payload: DatabaseFilterPayload) => void;
  refTableData?: RefTableDataMap;
}

function FilterGroup({ payload, columns, depth, onChange, refTableData }: FilterGroupProps) {
  const setLogic = (logic: "and" | "or") => onChange({ ...payload, logic });
  const setCondition = (index: number, condition: DatabaseFilterPayload["conditions"][number]) =>
    onChange({ ...payload, conditions: payload.conditions.map((entry, at) => (at === index ? condition : entry)) });
  const removeCondition = (index: number) =>
    onChange({ ...payload, conditions: payload.conditions.filter((_, at) => at !== index) });
  const setGroup = (index: number, group: DatabaseFilterPayload) =>
    onChange({ ...payload, groups: (payload.groups ?? []).map((entry, at) => (at === index ? group : entry)) });
  const removeGroup = (index: number) =>
    onChange({ ...payload, groups: (payload.groups ?? []).filter((_, at) => at !== index) });

  const addGroup = () => onChange({ ...payload, groups: [...(payload.groups ?? []), emptyFilter()] });
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

  return (
    <div
      data-slot="docblocks/filter-group"
      data-logic={payload.logic}
      className="flex flex-col gap-2 rounded-md border border-border p-2"
    >
      <div className="flex items-center gap-2">
        <SegmentSelector
          options={FILTER_LOGIC_OPTIONS}
          value={payload.logic}
          onChange={onLogicChange}
          ariaLabel="Filter logic"
          slot="docblocks/filter-logic"
          pillSlot="docblocks/filter-logic-pill"
          buttonAttrName="filter-logic"
          size="text"
        />
        <span className="text-xs text-muted-foreground">
          match {payload.logic === "and" ? "all" : "any"} of the conditions
        </span>
      </div>

      {payload.conditions.map((condition, index) => (
        <FilterConditionRow
          key={index}
          condition={condition}
          columns={columns}
          onChange={conditionChange(index)}
          onRemove={conditionRemove(index)}
          refTableData={refTableData}
        />
      ))}

      {(payload.groups ?? []).map((group, index) => (
        <div key={index} className="flex flex-col gap-1" data-slot="docblocks/filter-nested">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span data-slot="docblocks/filter-connector">{payload.logic === "and" ? "AND" : "OR"} nested group</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-slot="docblocks/filter-remove-group"
              onClick={removeGroupAt(index)}
            >
              Remove group
            </Button>
          </div>
          <FilterGroup
            payload={group}
            columns={columns}
            depth={depth + 1}
            onChange={groupChange(index)}
            refTableData={refTableData}
          />
        </div>
      ))}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-slot="docblocks/filter-add-condition"
          onClick={addCondition}
        >
          + Condition
        </Button>
        {depth < FILTER_MAX_DEPTH && (
          <Button type="button" variant="outline" size="sm" data-slot="docblocks/filter-add-group" onClick={addGroup}>
            + Group
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
}

function FilterConditionRow({ condition, columns, onChange, onRemove, refTableData }: FilterConditionRowProps) {
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
      className="flex flex-wrap items-center gap-2"
    >
      <BareSelect data-slot="docblocks/filter-column" value={column.id} onChange={onColumnChange}>
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
        variant="outline"
        size="sm"
        data-slot="docblocks/filter-remove-condition"
        onClick={onRemove}
      >
        ×
      </Button>
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

/** The value input per the annotation (the `in` / `not in` multi-value is a comma list). */
function ValueInput({ column, operator, value, onChange, refTableData }: ValueInputProps) {
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
        className="w-auto"
        placeholder="value, value"
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
          className="w-auto"
          value={value === undefined || value === null ? "" : String(value)}
          onChange={onNumberChange}
        />
      );
    case "boolean":
      return (
        <BareSelect
          data-slot="docblocks/filter-value"
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
          className="w-auto"
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
          className="w-auto"
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
          className="w-auto"
          value={value === undefined || value === null ? "" : String(value)}
          onChange={onScalarChange}
        />
      );
  }
}

export { FilterBuilder };
