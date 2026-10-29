/**
 * The recursive and/or filter editor: the top-level FilterBuilder renders a
 * FilterGroup (the group card), which renders the condition rows
 * (FilterConditionRow) + the nested groups; each condition's value is a
 * ValueInput over the column's annotation.
 */
import type { DatabaseFilterPayload } from "docblocks-core";

import { columnAnnotation } from "../bridge";
import type { BridgeColumn } from "../bridge";
import { refEntryKey } from "../grid/use-ref-tables";
import type { RefTableDataMap } from "../grid/use-ref-tables";
import { CONTROL_CLASS, GHOST_BUTTON_CLASS } from "./constants";
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

  return (
    <div
      data-slot="docblocks/filter-group"
      data-logic={payload.logic}
      className="flex flex-col gap-2 rounded-md border border-border p-2"
    >
      <div className="flex items-center gap-2">
        <div data-slot="docblocks/filter-logic" className="flex items-center rounded-md border border-border">
          <button
            type="button"
            data-filter-logic="and"
            className={`cursor-pointer px-2 py-0.5 text-xs outline-none ${
              payload.logic === "and" ? "bg-accent text-foreground" : "text-muted-foreground"
            }`}
            onClick={() => setLogic("and")}
          >
            AND
          </button>
          <button
            type="button"
            data-filter-logic="or"
            className={`cursor-pointer px-2 py-0.5 text-xs outline-none ${
              payload.logic === "or" ? "bg-accent text-foreground" : "text-muted-foreground"
            }`}
            onClick={() => setLogic("or")}
          >
            OR
          </button>
        </div>
        <span className="text-xs text-muted-foreground">
          match {payload.logic === "and" ? "all" : "any"} of the conditions
        </span>
      </div>

      {payload.conditions.map((condition, index) => (
        <FilterConditionRow
          key={index}
          condition={condition}
          columns={columns}
          onChange={(next) => setCondition(index, next)}
          onRemove={() => removeCondition(index)}
          refTableData={refTableData}
        />
      ))}

      {(payload.groups ?? []).map((group, index) => (
        <div key={index} className="flex flex-col gap-1" data-slot="docblocks/filter-nested">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span data-slot="docblocks/filter-connector">{payload.logic === "and" ? "AND" : "OR"} nested group</span>
            <button
              type="button"
              data-slot="docblocks/filter-remove-group"
              className={GHOST_BUTTON_CLASS}
              onClick={() => removeGroup(index)}
            >
              Remove group
            </button>
          </div>
          <FilterGroup
            payload={group}
            columns={columns}
            depth={depth + 1}
            onChange={(next) => setGroup(index, next)}
            refTableData={refTableData}
          />
        </div>
      ))}

      <div className="flex gap-2">
        <button
          type="button"
          data-slot="docblocks/filter-add-condition"
          className={GHOST_BUTTON_CLASS}
          onClick={() => {
            const column = columns[0];
            if (column === undefined) return;
            const firstOperator = columnAnnotation(column).operators[0] ?? "is";
            onChange({ ...payload, conditions: [...payload.conditions, { columnId: column.id, op: firstOperator }] });
          }}
        >
          + Condition
        </button>
        {depth < FILTER_MAX_DEPTH && (
          <button
            type="button"
            data-slot="docblocks/filter-add-group"
            className={GHOST_BUTTON_CLASS}
            onClick={() => onChange({ ...payload, groups: [...(payload.groups ?? []), emptyFilter()] })}
          >
            + Group
          </button>
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

  return (
    <div
      data-slot="docblocks/filter-condition"
      data-column-id={condition.columnId}
      data-op={operator}
      className="flex flex-wrap items-center gap-2"
    >
      <select
        data-slot="docblocks/filter-column"
        className={CONTROL_CLASS}
        value={column.id}
        onChange={(event) => {
          const nextColumn = columns.find((entry) => entry.id === event.target.value);
          if (nextColumn === undefined) return;
          onChange({
            columnId: nextColumn.id,
            op: columnAnnotation(nextColumn).operators[0] ?? "is",
            value: undefined,
          });
        }}
      >
        {columns.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name}
          </option>
        ))}
      </select>
      <select
        data-slot="docblocks/filter-operator"
        className={CONTROL_CLASS}
        value={operator}
        onChange={(event) => onChange({ ...condition, op: event.target.value, value: undefined })}
      >
        {annotation.operators.map((entry) => (
          <option key={entry} value={entry}>
            {entry}
          </option>
        ))}
      </select>
      {needsValue && (
        <ValueInput
          column={column}
          operator={operator}
          value={condition.value}
          onChange={(value) => onChange({ ...condition, op: operator, value })}
          refTableData={refTableData}
        />
      )}
      <button
        type="button"
        data-slot="docblocks/filter-remove-condition"
        className={GHOST_BUTTON_CLASS}
        onClick={onRemove}
      >
        ×
      </button>
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
  if (multiValue) {
    const text = Array.isArray(value) ? value.join(", ") : value === undefined || value === null ? "" : String(value);
    return (
      <input
        type="text"
        data-slot="docblocks/filter-value"
        className={CONTROL_CLASS}
        placeholder="value, value"
        value={text}
        onChange={(event) => {
          const parts = event.target.value
            .split(",")
            .map((part) => part.trim())
            .filter((part) => part.length > 0);
          onChange(parts.length > 0 ? parts : undefined);
        }}
      />
    );
  }
  switch (annotation.valueInput) {
    case "number":
      return (
        <input
          type="number"
          data-slot="docblocks/filter-value"
          className={CONTROL_CLASS}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))}
        />
      );
    case "boolean":
      return (
        <select
          data-slot="docblocks/filter-value"
          className={CONTROL_CLASS}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value === "true")}
        >
          <option value="">—</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      );
    case "date":
      return (
        <input
          type="date"
          data-slot="docblocks/filter-value"
          className={CONTROL_CLASS}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value)}
        />
      );
    case "datetime":
      return (
        <input
          type="datetime-local"
          data-slot="docblocks/filter-value"
          className={CONTROL_CLASS}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value)}
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
        <select
          data-slot="docblocks/filter-value"
          className={CONTROL_CLASS}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value)}
        >
          <option value="">—</option>
          {entries.map((entry) => (
            <option key={entry} value={entry}>
              {refTable !== undefined && refTable.displays[entry] !== undefined && refTable.displays[entry] !== ""
                ? refTable.displays[entry]
                : entry}
            </option>
          ))}
        </select>
      );
    }
    default:
      return (
        <input
          type="text"
          data-slot="docblocks/filter-value"
          className={CONTROL_CLASS}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value)}
        />
      );
  }
}

export { FilterBuilder };
