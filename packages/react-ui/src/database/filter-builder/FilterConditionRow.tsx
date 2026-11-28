/**
 * The filter's condition's row (the column / the operator / the value's
 * inputs + the remove; the row draws its share of the group's connector
 * line — the last item stops it at its tick).
 */
import { useTranslation } from "react-i18next";

import type { DatabaseFilterPayload } from "docblocks-core";

import { BareSelect, Button } from "../../shared/ui";
import { cn } from "../../shared/ui/cn";
import { X } from "../../shared/ui/icons";
import { columnAnnotation } from "../bridge";
import type { BridgeColumn } from "../bridge";
import type { RefTableDataMap } from "../grid/use-ref-tables";
import { FilterOperatorPicker } from "./FilterOperatorPicker";
import { ValueInput } from "./ValueInput";

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
      <FilterOperatorPicker
        operators={annotation.operators}
        value={operator}
        onPick={(nextOperator) => onChange({ ...condition, op: nextOperator, value: undefined })}
      />
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

export { FilterConditionRow };
