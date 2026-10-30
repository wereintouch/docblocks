"use client";

import { format } from "date-fns";

import * as React from "react";

import { Button } from "./Button";
import { Calendar } from "./Calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";
import { Separator } from "./Separator";
import { TimeSegments } from "./TimeSegments";
import { cn } from "./cn";
import { CalendarIcon } from "./icons";

/** The trigger's label: the compact date, + the time when it is not the
 *  midnight zero (the seconds stand only when they are not zero). */
function labelOf(value: Date): string {
  const base = format(value, "dd.MM.yyyy");
  if (value.getHours() === 0 && value.getMinutes() === 0 && value.getSeconds() === 0) return base;
  const label = format(value, "HH:mm");
  return value.getSeconds() !== 0 ? `${base} ${label}:${format(value, "ss")}` : `${base} ${label}`;
}

function hasTime(value: Date | null): boolean {
  return value !== null && (value.getHours() !== 0 || value.getMinutes() !== 0 || value.getSeconds() !== 0);
}

function datePart(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

/**
 * The date-and-time picker: the `DatePicker`'s calendar + the `TimeSegments`
 * box in one portaled popover.
 *
 * The component is controlled: the `value` is a local-calendar `Date`, and
 * `onSelect` commits the picked date + the typed time (the commit stands on
 * the popover close — the escape / the outside press / an explicit close —
 * as one step; a no-op close stands no commit). The drafts stand from the
 * value at the open (the in-flight draft stands the mid-session value
 * changes), the day pick edits the draft date (the same-day toggle stands no
 * reset — the deferred commit's contract), the time box edits the draft
 * time; the extra props stand on the
 * trigger button (the `data-*` hooks included; the native `value` /
 * `onSelect` button props are omitted — they stand the picker's contract).
 */
function DateTimePicker({
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
  const [draftDate, setDraftDate] = React.useState<Date | null>(null);
  const [draftTime, setDraftTime] = React.useState<string | null>(null);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      // The drafts stand from the value at the open (the close commits, so
      // the in-flight draft stands the mid-session value changes).
      setDraftDate(value !== null ? datePart(value) : null);
      setDraftTime(value !== null && hasTime(value) ? format(value, "HH:mm:ss") : null);
      setOpen(true);
      return;
    }
    setOpen(false);
    const committed = draftDate === null ? null : datePart(draftDate);
    if (draftTime !== null && committed !== null) {
      const [hours, minutes, seconds] = draftTime.split(":");
      committed.setHours(Number(hours), Number(minutes), Number(seconds));
    }
    // A no-op close (the draft stands the value) stands no commit.
    const before = value?.getTime() ?? null;
    const after = committed?.getTime() ?? null;
    if (before === after) return;
    onSelect(committed);
  };

  // The day-picker's same-day toggle (the undefined stand) resets no draft
  // date: the commit is deferred to the close, so the toggle would clear
  // the draft date and lose the typed time (the clear stand is the date
  // picker's immediate-commit contract only).
  const onDraftDateSelect = (date: Date | undefined) => {
    if (date === undefined || date === null) return;
    setDraftDate(datePart(date));
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          data-empty={value ? undefined : true}
          className={cn("justify-start text-left font-normal data-[empty=true]:text-muted-foreground", className)}
          {...triggerProps}
        >
          <CalendarIcon />
          {value ? labelOf(value) : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <Calendar
          mode="single"
          selected={draftDate ?? undefined}
          {...(value !== null ? { defaultMonth: value } : {})}
          onSelect={onDraftDateSelect}
        />
        <Separator />
        <div className="p-2">
          <TimeSegments id="date-time-picker-time" value={draftTime} onChange={setDraftTime} clearable />
        </div>
      </PopoverContent>
    </Popover>
  );
}

export { DateTimePicker };
