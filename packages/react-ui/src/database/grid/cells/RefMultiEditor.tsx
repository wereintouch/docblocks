/** The ref column's many-cardinality editor (the multi-enum / the row links):
 *  the popover's checkbox list over the options. */
import { useEffect, useMemo, useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "../../../shared/ui/Popover";
import { PICKER_SIDE_OFFSET_PX } from "../constants";
import { OptionPickerList } from "./OptionPickerList";
import { RefValueChips } from "./RefValueChips";
import type { RefOption } from "./models";
import { usePickerWidthPx } from "./use-picker-width";

interface RefMultiEditorProps {
  /** The current values (the committed array, string stand). */
  values: string[];
  options: RefOption[];
  /** The committed value stand (one `updateRow` per toggle — the draft
   *  stands none, so the external teardown loses nothing). */
  onCommit: (next: string[]) => void;
  onEditEnd: () => void;
}
/**
 * The ref column's many-cardinality editor (the multi-enum / the row
 * links): the popover's checkbox list over the options; the press over
 * the option stands the immediate toggle (one `updateRow` per option —
 * the draft stands none, so the external teardown loses nothing).
 */
/**
 * The enum column's many-cardinality editor (the multi-enum): the popover's
 * option list over the cell's width (the search's row, the option's chip +
 * the check over the selected); the press over the option stands the
 * immediate toggle (one `updateRow` per option — the draft stands none,
 * so the external teardown loses nothing).
 */
function RefMultiEditor({ values, options, onCommit, onEditEnd }: RefMultiEditorProps) {
  const toggle = (option: RefOption, include: boolean) => {
    const next = new Set(values);
    if (include) next.add(option.value);
    else next.delete(option.value);
    onCommit([...next]);
  };
  const [trigger, setTrigger] = useState<HTMLSpanElement | null>(null);
  const optionLabels = useMemo(() => options.map((option) => option.label), [options]);
  // The width's clamp (the cell's floor, the widest option's drive, the
  // 220 px's ceiling) over the content's font's stand.
  const width = usePickerWidthPx(true, trigger, optionLabels, true);
  // The overflow's stand (the clipped's train): the list's height's stretch
  // (the values' full's stand over the scroll's inner stand).
  const [tall, setTall] = useState(false);
  useEffect(() => {
    const chips = trigger?.querySelector<HTMLElement>('[data-slot="docblocks/database-ref-chips"]');
    setTall(chips != null && chips.scrollWidth > chips.clientWidth + 1);
  }, [trigger]);
  const noOp = () => undefined;
  const onPopoverClose = (open: boolean) => {
    if (!open) onEditEnd();
  };
  const onOptionToggle = (value: string) => {
    const option = options.find((entry) => entry.value === value);
    if (option !== undefined) toggle(option, !values.includes(value));
  };

  return (
    <Popover open onOpenChange={onPopoverClose}>
      <PopoverTrigger asChild>
        <span
          ref={setTrigger}
          data-slot="docblocks/database-ref-multi-trigger"
          className="pointer-events-none block w-full text-(length:--docblocks-font-size)"
        >
          <RefValueChips values={values} options={options} fade />
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
          multi
          values={values}
          tall={tall}
          onPick={noOp}
          onToggle={onOptionToggle}
          onEditEnd={onEditEnd}
        />
      </PopoverContent>
    </Popover>
  );
}

export { RefMultiEditor };
