/**
 * The filter's value's input over the column's annotation (the `in` /
 * `not in`'s multi-value's comma list, the per-type's scalar inputs — the
 * number / the boolean / the date / the datetime's pickers, the ref's
 * select).
 */
import { useTranslation } from "react-i18next";

import { BareSelect, DatePicker, DateTimePicker, Input } from "../../shared/ui";
import { columnAnnotation } from "../bridge";
import type { BridgeColumn } from "../bridge";
import { refEntryKey } from "../grid/use-ref-tables";
import type { RefTableDataMap } from "../grid/use-ref-tables";
import { formatCellDateTime, parseCellDateTime } from "../grid/utils";

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
      // The shared single-date picker over the wire's "YYYY-MM-DD" (the
      // re-pick's toggle commits the clear — the raw input's empty-stand
      // contract).
      return (
        <DatePicker
          data-slot="docblocks/filter-value"
          className="h-8 min-w-0 flex-1 px-2 py-0.5"
          value={parseCellDateTime(value)}
          onSelect={(date) => onChange(formatCellDateTime(date) ?? undefined)}
        />
      );
    case "datetime":
      // The shared date-and-time picker over the wire's
      // "YYYY-MM-DD[THH:MM[:SS]]" (the commit stands on the Enter + the
      // popover's close, the Escape cancels the draft — the cell's
      // datetime's contract; the midnight zero stands the date only).
      return (
        <DateTimePicker
          data-slot="docblocks/filter-value"
          className="h-8 min-w-0 flex-1 px-2 py-0.5"
          value={parseCellDateTime(value)}
          onSelect={(date) => onChange(formatCellDateTime(date) ?? undefined)}
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

export { ValueInput };
