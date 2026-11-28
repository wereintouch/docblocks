/**
 * The filter's operator's picker: the popover's option list over the column
 * annotation's catalog (the trigger stands the selected operator's localized
 * label, the list stands the catalog over its declared order with the active
 * option marked). The pick commits the wire's op — the display label never
 * reaches the payload (the op's contract), and a consumer's custom operator
 * (the `operators` override) stands its raw form when the catalog has no
 * label for it.
 */
import { useTranslation } from "react-i18next";

import { useState } from "react";

import { Button } from "../../shared/ui/Button";
import { Popover, PopoverContent, PopoverTrigger } from "../../shared/ui/Popover";
import { cn } from "../../shared/ui/cn";

interface FilterOperatorPickerProps {
  /** The operator's catalog (the column annotation's order — the list's order). */
  operators: string[];
  /** The selected operator (the wire's op). */
  value: string;
  /** The pick's commit (the wire's op). */
  onPick: (operator: string) => void;
}

function FilterOperatorPicker({ operators, value, onPick }: FilterOperatorPickerProps) {
  const { t } = useTranslation("database");
  const [open, setOpen] = useState(false);
  // The label over the wire's op (the absent key stands the raw op — the
  // consumer's custom operator's form).
  const label = (operator: string) => t(`filter.operators.${operator}`, operator);
  const pick = (operator: string) => {
    setOpen(false);
    onPick(operator);
  };
  const pickOption = (operator: string) => () => pick(operator);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* The trigger stands the field's frame (the column select's parity). */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-slot="docblocks/filter-operator"
          data-operator={value}
          className="
            h-8 max-w-45 truncate rounded-md border border-input bg-transparent px-2 text-sm text-foreground
            outline-none
            focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50
            dark:bg-input/30
          "
        >
          {label(value)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-48 gap-0.5 p-1.5">
        {operators.map((operator) => (
          <Button
            key={operator}
            type="button"
            variant="ghost"
            size="sm"
            data-slot="docblocks/filter-operator-option"
            data-operator={operator}
            data-active={operator === value ? "true" : undefined}
            className={cn(
              "w-full cursor-pointer justify-start rounded-md px-2 py-1.5 font-normal",
              operator === value && "bg-muted"
            )}
            onClick={pickOption(operator)}
          >
            {label(operator)}
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export { FilterOperatorPicker };
