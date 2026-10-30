/** The enum column's single-cardinality picker: the popover's option list
 *  over the cell's width. */
import { useEffect, useMemo, useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "../../../shared/ui/Popover";
import { PICKER_SIDE_OFFSET_PX } from "../constants";
import { OptionPickerList } from "./OptionPickerList";
import { RefValueChips } from "./RefValueChips";
import type { RefOption } from "./models";
import { usePickerWidthPx } from "./use-picker-width";

interface EnumPickerProps {
  /** The options (the configured's order — the picker's list order). */
  options: RefOption[];
  /** The current value (the option's row id or the empty stand). */
  current: string | null;
  /** The session stand (the grid's edit session). */
  open: boolean;
  onPick: (value: string) => void;
  /** The empty's option (the clear → the null's commit). */
  onClear: () => void;
  onEditEnd: () => void;
}
/**
 * The enum column's single-cardinality picker: the popover's option list
 * over the cell's width (the search's row, the empty's clear option, the
 * options over the configured's order). The empty cell stands the cell's
 * background only (the trigger's box is out — the chip stands the value).
 * The one press stands the cell's select (the grid's contract), the second
 * press / the double press stands the list (the `open`'s session stand).
 */
function EnumPicker({ options, current, open, onPick, onClear, onEditEnd }: EnumPickerProps) {
  const [trigger, setTrigger] = useState<HTMLSpanElement | null>(null);
  const optionLabels = useMemo(() => options.map((option) => option.label), [options]);
  // The width's clamp (the cell's floor, the widest option's drive, the
  // 220 px's ceiling) over the content's font's stand.
  const width = usePickerWidthPx(open, trigger, optionLabels, false);
  // The overflow's stand (the clipped's chip): the list's height's stretch
  // (the value's full's stand over the scroll's inner stand).
  const [tall, setTall] = useState(false);
  useEffect(() => {
    const chips = trigger?.querySelector<HTMLElement>('[data-slot="docblocks/database-ref-chips"]');
    setTall(open && chips != null && chips.scrollWidth > chips.clientWidth + 1);
  }, [open, trigger]);
  const currentValues = current === null ? [] : [current];
  const noOp = () => undefined;
  const onOpenChange = (isOpen: boolean) => {
    if (!isOpen) onEditEnd();
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <span
          ref={setTrigger}
          data-slot="docblocks/database-enum-picker-trigger"
          className="pointer-events-none block w-full px-1 text-(length:--docblocks-font-size)"
        >
          <RefValueChips values={currentValues} options={options} />
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={PICKER_SIDE_OFFSET_PX}
        style={width !== undefined ? { width: `${width}px` } : undefined}
        className="flex w-(--radix-popover-trigger-width) flex-col gap-1 p-2"
      >
        <OptionPickerList
          options={options}
          multi={false}
          values={currentValues}
          currentEmpty={current === null}
          tall={tall}
          onPick={onPick}
          onToggle={noOp}
          onClear={onClear}
          onEditEnd={onEditEnd}
        />
      </PopoverContent>
    </Popover>
  );
}

export { EnumPicker };
