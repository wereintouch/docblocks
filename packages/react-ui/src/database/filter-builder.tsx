/**
 * The filter builder: the recursive and/or payload editor (the package's
 * component, the `FilterBlock` reference). Annotation-driven — the
 * operator catalog and the value input kind come from the
 * `BridgeColumn` (the consumer's `operators` override or the package's
 * default per Postgres type). The result is written to the block's
 * `filter` attr via `updateBlock` (CRDT data, undo-able). An empty value
 * makes the condition inapplicable (the `filterIsComplete` guard — the
 * UI must not apply an incomplete payload).
 */
import type { DatabaseFilterPayload } from "docblocks-core";

import { columnAnnotation } from "./bridge";
import type { BridgeColumn } from "./bridge";

/** The filter recursion depth cap (the package's UI constant; a backend
 *  validates the depth on its own). */
const FILTER_MAX_DEPTH = 4;

/** The empty filter payload (the "no filter" shape the Clear writes). */
function emptyFilter(): DatabaseFilterPayload {
  return { logic: "and", conditions: [] };
}

/** Whether the payload is applicable: every condition that needs a value
 *  has one (an empty value = the condition is inapplicable). */
function filterIsComplete(payload: DatabaseFilterPayload | null, columns: BridgeColumn[]): boolean {
  if (payload === null) return true;
  for (const condition of payload.conditions) {
    const column = columns.find((entry) => entry.id === condition.columnId);
    if (column === undefined) return false;
    if (columnAnnotation(column).valueless.has(condition.op)) continue;
    const value = condition.value;
    if (value === undefined || value === null || value === "") return false;
    if (Array.isArray(value) && value.length === 0) return false;
  }
  for (const group of payload.groups ?? []) {
    if (!filterIsComplete(group, columns)) return false;
  }
  return true;
}

/** The control look (the shared input / select styling). The standard
 *  tokens stand — the builder renders inside the portaled popover
 *  (the `--docblocks-*` editor-root tokens do not reach the body). */
const CONTROL_CLASS = `h-8 rounded-md border border-border bg-transparent px-2 text-sm text-foreground outline-none`;

/** The ghost button look (the add / the remove affordances). */
const GHOST_BUTTON_CLASS = `cursor-pointer rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground outline-none hover:opacity-70`;

interface FilterBuilderProps {
  /** The payload being edited; null = the empty filter. */
  value: DatabaseFilterPayload | null;
  /** The columns (the annotation source). */
  columns: BridgeColumn[];
  /** The draft change (the parent keeps the draft until Apply). */
  onChange: (payload: DatabaseFilterPayload) => void;
}

/** The recursive and/or filter editor (the group card). */
function FilterBuilder({ value, columns, onChange }: FilterBuilderProps) {
  const payload = value ?? emptyFilter();
  return (
    <div data-slot="docblocks/filter-builder" className="flex max-h-80 flex-col gap-2 overflow-y-auto">
      {columns.length === 0 ? (
        <div data-slot="docblocks/filter-empty" className="text-sm text-muted-foreground">
          No columns to filter on.
        </div>
      ) : (
        <FilterGroup payload={payload} columns={columns} depth={0} onChange={onChange} />
      )}
    </div>
  );
}

interface FilterGroupProps {
  payload: DatabaseFilterPayload;
  columns: BridgeColumn[];
  depth: number;
  onChange: (payload: DatabaseFilterPayload) => void;
}

function FilterGroup({ payload, columns, depth, onChange }: FilterGroupProps) {
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
          <FilterGroup payload={group} columns={columns} depth={depth + 1} onChange={(next) => setGroup(index, next)} />
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
}

function FilterConditionRow({ condition, columns, onChange, onRemove }: FilterConditionRowProps) {
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
}

/** The value input per the annotation (the `in` / `not in` multi-value is a comma list). */
function ValueInput({ column, operator, value, onChange }: ValueInputProps) {
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
    case "select":
      return (
        <select
          data-slot="docblocks/filter-value"
          className={CONTROL_CLASS}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value)}
        >
          <option value="">—</option>
          {(column.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
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

export { FILTER_MAX_DEPTH, emptyFilter, filterIsComplete, FilterBuilder };
