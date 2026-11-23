/**
 * The filter group's recursive body (the logic's selector + the body's
 * items — the condition rows + the nested groups' cards — + the add's
 * buttons; every item draws its share of the group's connector line).
 */
import { useTranslation } from "react-i18next";

import type { DatabaseFilterPayload } from "docblocks-core";

import { Button } from "../../shared/ui";
import { SegmentSelector } from "../../shared/ui/SegmentSelector";
import type { SegmentOption } from "../../shared/ui/SegmentSelector";
import { cn } from "../../shared/ui/cn";
import { X } from "../../shared/ui/icons";
import { columnAnnotation } from "../bridge";
import type { BridgeColumn } from "../bridge";
import type { RefTableDataMap } from "../grid/use-ref-tables";
import { FilterConditionRow } from "./FilterConditionRow";
import { FILTER_MAX_DEPTH, emptyFilter } from "./utils";

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

export { FilterGroup };
