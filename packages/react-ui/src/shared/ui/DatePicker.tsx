"use client";

import { format } from "date-fns";

import * as React from "react";

import { Button } from "./Button";
import { Calendar } from "./Calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";
import { cn } from "./cn";
import { CalendarIcon } from "./icons";

/**
 * The single-date picker: the trigger stands the calendar icon + the
 * formatted date (the `PPP` long form) or the placeholder (the empty
 * state), and the calendar stands in the portaled popover content.
 *
 * The component is controlled: the `value` is a local-calendar `Date`
 * (the consumer converts the cell / doc value to it), and `onSelect`
 * fires on a day pick (picking the selected day again clears it — the
 * day-picker's toggle) and the popover closes on the pick (the cell's
 * focus stands back on the trigger). The extra props stand on the trigger
 * button (the `data-*` hooks included; the native `value` / `onSelect`
 * button props are omitted — they stand the picker's own contract).
 */
function DatePicker({
  value,
  onSelect,
  className,
  placeholder = "—",
  ...triggerProps
}: {
  value: Date | null;
  onSelect: (date: Date | null) => void;
  className?: string;
  placeholder?: string;
} & Omit<React.ComponentPropsWithoutRef<"button">, "value" | "onSelect">) {
  const [open, setOpen] = React.useState(false);
  // The day's pick: the popover closes on the pick (the immediate-commit
  // contract).
  const onDateSelect = (date: Date | undefined) => {
    setOpen(false);
    onSelect(date ?? null);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          data-empty={value ? undefined : true}
          className={cn("justify-start text-left font-normal data-[empty=true]:text-muted-foreground", className)}
          {...triggerProps}
        >
          <CalendarIcon />
          {value ? format(value, "PPP") : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <Calendar mode="single" selected={value ?? undefined} onSelect={onDateSelect} />
      </PopoverContent>
    </Popover>
  );
}

export { DatePicker };
