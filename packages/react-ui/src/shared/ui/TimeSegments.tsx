import * as React from "react";

import { Button } from "./Button";
import { TimeSegment, type TimeSegmentType } from "./TimeSegment";
import { cn } from "./cn";
import { X } from "./icons";

interface Segments {
  h: string;
  m: string;
  s: string;
}

const EMPTY_SEGMENTS: Segments = { h: "", m: "", s: "" };

// Wire "HH:MM:SS" -> per-segment display digits ("" when absent).
function toSegments(wire: string | null | undefined): Segments {
  if (typeof wire !== "string" || wire === "") return { ...EMPTY_SEGMENTS };
  const [h, m, s] = wire.split(":");
  return { h: h ?? "", m: m ?? "", s: s ?? "" };
}

// Two-digit normalizer: "" -> "00", a single digit -> "0X", 2 digits stand.
function padSeg(value: string): string {
  if (value === "") return "00";
  return value.length === 1 ? `0${value}` : value;
}

// Per-segment digits -> wire "HH:MM:SS"; null when every segment is empty.
function toWire({ h, m, s }: Segments): string | null {
  if (h === "" && m === "" && s === "") return null;
  return `${padSeg(h)}:${padSeg(m)}:${padSeg(s)}`;
}

interface TimeSegmentsOptions {
  /** Base id; the segments get `id`, `${id}-m`, `${id}-s`. Enables the
   *  auto-advance. */
  id?: string;
  /** The canonical "HH:MM:SS" wire value; empty/null/undefined = no time. */
  value: string | null | undefined;
  /** Called with the next "HH:MM:SS" wire value (null when fully cleared). */
  onChange: (wire: string | null) => void;
  disabled?: boolean;
  /** When true and a value stands, the clear button (the box's end) is
   *  rendered. */
  clearable?: boolean;
  className?: string;
}

/**
 * Three `TimeSegment`s (hours / minutes / seconds) joined by the colon
 * separators, drawn as a single box. The control owns the time business
 * logic — the "HH:MM:SS" wire format, the focus auto-advance between the
 * segments, and the two-digit normalization ("00" / "0X") when the focus
 * leaves the group — so every time editor stands consistent.
 *
 * The draft contract: the typed draft (the per-segment digits) stands
 * while the group holds the focus — an external `value` change (the
 * reset / the clear from outside) stands no draft change during the
 * typing. When the focus leaves the group, the draft syncs from the
 * current `value`, so the external change lands on the next render.
 */
function TimeSegments({ id, value, onChange, disabled, clearable, className }: TimeSegmentsOptions) {
  const [seg, setSeg] = React.useState<Segments>(() => toSegments(value));
  // Whether a segment holds the focus: while the group is typed the
  // draft stands (the external `value` change stands no draft change);
  // on the focus leave the draft syncs from the current `value`.
  const [editing, setEditing] = React.useState(false);
  React.useEffect(() => {
    if (!editing) setSeg(toSegments(value));
  }, [value, editing]);

  const filled = value !== undefined && value !== null && value !== "";

  const emit = (next: Segments) => {
    setSeg(next);
    onChange(toWire(next));
  };

  const handleSegment = (which: TimeSegmentType) => (segmentValue: string) => {
    emit({ ...seg, [which]: segmentValue });
    if (id && segmentValue.length === 2 && which !== "s") {
      document.getElementById(which === "h" ? `${id}-m` : `${id}-s`)?.focus();
    }
  };

  const handleClear = () => {
    setSeg({ ...EMPTY_SEGMENTS });
    onChange(null);
  };

  // When the focus leaves the whole group (not the h→m→s hops), normalize
  // the segments to two digits ("00" / "0X") so the box reads a uniform
  // time. A fully empty group stands empty. The display stands only — the
  // wire value is already two-digit via `toWire`.
  const handleBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    const stays = next instanceof Node && event.currentTarget.contains(next);
    if (stays) return;
    setEditing(false);
    if (seg.h === "" && seg.m === "" && seg.s === "") return;
    setSeg({ h: padSeg(seg.h), m: padSeg(seg.m), s: padSeg(seg.s) });
  };

  const colon = "px-0.5 text-muted-foreground";

  return (
    <div
      data-slot="time-segments"
      data-filled={filled || undefined}
      onFocus={() => setEditing(true)}
      onBlur={handleBlur}
      className={cn(
        `
          group relative flex h-9 w-fit items-center rounded-md border border-input bg-transparent pr-2 pl-2 shadow-xs
          transition-[color,box-shadow] duration-300
          focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40
          dark:bg-input/30
        `,
        clearable && "pr-8",
        className
      )}
    >
      <TimeSegment segmentType="h" id={id} value={seg.h} onChange={handleSegment("h")} disabled={disabled} />
      <span className={colon}>:</span>
      <TimeSegment
        segmentType="m"
        id={id ? `${id}-m` : undefined}
        value={seg.m}
        onChange={handleSegment("m")}
        disabled={disabled}
      />
      <span className={colon}>:</span>
      <TimeSegment
        segmentType="s"
        id={id ? `${id}-s` : undefined}
        value={seg.s}
        onChange={handleSegment("s")}
        disabled={disabled}
      />
      {clearable && filled && (
        <Button
          type="button"
          variant="ghost"
          tabIndex={-1}
          aria-label="Clear the time"
          onClick={handleClear}
          className="
            absolute top-1/2 right-2 size-auto -translate-y-1/2 p-0 text-muted-foreground transition-colors duration-300
            hover:bg-transparent hover:text-foreground
            focus-visible:ring-0
          "
        >
          <X className="size-3.5" />
        </Button>
      )}
    </div>
  );
}

export { TimeSegments };
export type { TimeSegmentsOptions };
