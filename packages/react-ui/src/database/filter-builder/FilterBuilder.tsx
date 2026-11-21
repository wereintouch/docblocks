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

import type { SegmentOption } from "../../shared/ui/SegmentSelector";
import type { BridgeColumn } from "../bridge";
import type { RefTableDataMap } from "../grid/use-ref-tables";
import { FilterGroup } from "./FilterGroup";
import { emptyFilter } from "./utils";

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

export { FilterBuilder };
