import * as React from "react";

import { cn } from "./cn";

/** The time-of-day segment kinds: the hour stands its own cap (23), the
 *  minute / the second cap at 59. */
type TimeSegmentType = "h" | "m" | "s";

const SEGMENT_MAX: Record<TimeSegmentType, number> = { h: 23, m: 59, s: 59 };

interface TimeSegmentOptions {
  /** Which time-of-day segment; sets the max value (h → 23, m/s → 59). */
  segmentType: TimeSegmentType;
  /** The segment's own digits ("0".."23" / "0".."59"); "" = empty. */
  value: string;
  /** Called with the cleaned 1-2 digit value ("" when the user empties it). */
  onChange: (value: string) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * One time-of-day segment — hours, minutes or seconds — as a narrow numeric
 * input capped at the segment's own maximum. Pure UI: it only knows its own
 * 1-2 digit value and its cap. It does not parse or assemble a full time and
 * holds no cross-segment state — that lives in the control that composes the
 * segments (`TimeSegments`).
 *
 * It is deliberately borderless: the enclosing control draws the single box
 * (border / radius / focus ring) so several segments read as one input. The
 * space placeholder stands the segment's width while it is empty.
 */
function TimeSegment({ segmentType, value, onChange, id, disabled, className }: TimeSegmentOptions) {
  const max = SEGMENT_MAX[segmentType];

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const digits = event.target.value.replace(/\D/g, "").slice(0, 2);
    onChange(digits === "" ? "" : String(Math.min(parseInt(digits, 10), max)));
  };

  return (
    <input
      id={id}
      data-segment={segmentType}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      maxLength={2}
      placeholder=" "
      value={value}
      onChange={handleChange}
      disabled={disabled}
      className={cn(
        `
          h-full w-10 bg-transparent px-0 text-center text-foreground tabular-nums outline-none
          disabled:cursor-not-allowed disabled:opacity-50
        `,
        // The box stands on the enclosing control (the segment adds no own
        // border / radius / focus ring of its own).
        "rounded-none border-0 shadow-none",
        className
      )}
    />
  );
}

export { TimeSegment };
export type { TimeSegmentOptions, TimeSegmentType };
