/** The shared option picker's list (the single's / the multi's): the
 *  search's row, the empty's option, and the options over the configured's
 *  order. */
import { useState } from "react";

import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Input } from "../../../shared/ui/Input";
import { cn } from "../../../shared/ui/cn";
import { OPTION_CHIP_INK } from "./constants";
import type { RefOption } from "./models";

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
  const noOp = () => undefined;
  const onQueryChange = (event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value);
  const onClearOption = () => {
    onClear?.();
    onEditEnd();
  };
  const pickOption = (option: RefOption) => () => {
    if (multi) onToggle(option.value);
    else {
      onPick(option.value);
      onEditEnd();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Input
        size="sm"
        type="search"
        data-slot="docblocks/database-enum-picker-search"
        autoFocus
        placeholder="Search options"
        className="h-7 cursor-text text-xs focus:bg-muted/40"
        value={query}
        onChange={onQueryChange}
      />
      <div
        data-slot="docblocks/database-enum-picker-list"
        className={cn("overflow-y-auto", tall ? "max-h-80" : "max-h-48")}
      >
        <div className="flex flex-col gap-1">
          {onClear !== undefined && (
            <Button
              data-slot="docblocks/database-enum-picker-clear"
              variant="ghost"
              size="sm"
              className={cn(
                "w-full cursor-pointer justify-start rounded-(--docblocks-radius) px-2 py-1.5 text-sm font-normal",
                "text-muted-foreground",
                currentEmpty && "bg-muted text-foreground"
              )}
              onClick={onClearOption}
            >
              —
            </Button>
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
              onClick={pickOption(option)}
            >
              {multi && (
                <Checkbox
                  checked={values.includes(option.value)}
                  onCheckedChange={noOp}
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

export { OptionPickerList };
