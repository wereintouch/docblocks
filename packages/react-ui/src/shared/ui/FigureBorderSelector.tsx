import { useCallback, useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

import { cn } from "./cn";

/**
 * The figure border's width selector (the shape toolbar's border-width
 * control): a horizontal line with the given number of dots and a handle
 * standing on the current one. A press / a drag moves the handle and it
 * SNAPS to the nearest dot (the live stand — the onChange fires on the
 * move, not only on the release). The dots are evenly spaced across the
 * track (the first and the last stand at the edges). The filled-progress
 * stand: the track's segment from the start to the handle's center and the
 * dots at / left of the handle stand the accent (`--primary`); the rest
 * stands `--border`. Keyboard: the arrow keys step one dot, Home / End
 * stand the edges (the slider contract).
 *
 * A UI-only primitive (the design system): no doc / command knowledge —
 * the values stand the consumer's (the toolbar maps the index to the
 * 1..N px border width and the updateBlock).
 */
function FigureBorderSelector({
  points,
  value,
  onChange,
  label,
  title,
  className,
}: {
  /** The number of the dots (1 or more). */
  points: number;
  /** The current dot's index (0-based, clamped to 0..points-1). */
  value: number;
  /** The snap callback (the nearest dot's index, the live drag stand). */
  onChange: (index: number) => void;
  /** The accessible name (the slider's aria-label). */
  label: string;
  /** The native tooltip's text (the control's hint). */
  title?: string;
  className?: string;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const clamped = Math.max(0, Math.min(points - 1, Math.round(value)));

  /** The client X -> the nearest dot's index (the magnet stand). */
  const indexAt = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (track === null) return clamped;
      const rect = track.getBoundingClientRect();
      if (rect.width === 0) return clamped;
      const ratio = (clientX - rect.left) / rect.width;
      return Math.max(0, Math.min(points - 1, Math.round(ratio * (points - 1))));
    },
    [points, clamped]
  );

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const index = indexAt(event.clientX);
    if (index !== clamped) onChange(index);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.buttons !== 1) return;
    const index = indexAt(event.clientX);
    if (index !== clamped) onChange(index);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = clamped - 1;
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") next = clamped + 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = points - 1;
    if (next === null) return;
    event.preventDefault();
    if (next < 0 || next > points - 1 || next === clamped) return;
    onChange(next);
  };

  // The dot / handle positions (the even spread: the i / (points - 1)
  // ratio of the track — a single dot stands the center).
  const dotPosition = (index: number) => (points === 1 ? 50 : (index / (points - 1)) * 100);

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={points - 1}
      aria-valuenow={clamped}
      aria-valuetext={String(clamped + 1)}
      data-slot="docblocks/figure-border-selector"
      title={title}
      className={cn(
        "relative h-5 w-16 cursor-pointer touch-none outline-none",
        "rounded-(--docblocks-radius) focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onKeyDown={onKeyDown}
    >
      {/* The track (the horizontal line through the dots' centers). */}
      <div className="absolute top-1/2 right-0 left-0 h-px -translate-y-1/2 bg-(--border)" aria-hidden />
      {/* The fill segment (the accent from the track's start to the
          handle's center — the filled-progress stand; zero width at the
          leftmost dot, the whole track at the rightmost). */}
      <div
        className="absolute top-1/2 left-0 h-px -translate-y-1/2 bg-(--primary)"
        style={{ width: `${dotPosition(clamped)}%` }}
        aria-hidden
      />
      {Array.from({ length: points }, (_, index) => (
        <span
          key={index}
          aria-hidden
          className={cn(
            "absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full",
            index <= clamped ? "bg-(--primary)" : "bg-(--border)"
          )}
          style={{ left: `${dotPosition(index)}%` }}
        />
      ))}
      {/* The handle (magnets to the nearest dot while the drag stands). */}
      <span
        aria-hidden
        className={cn(
          "absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full",
          "border-2 border-(--primary) bg-background"
        )}
        style={{ left: `${dotPosition(clamped)}%` }}
      />
    </div>
  );
}

export { FigureBorderSelector };
