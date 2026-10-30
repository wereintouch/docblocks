/**
 * The sliding-pill segment selector: a row of plain toggle buttons and one
 * shared sliding pill (a framer-free CSS transition over the measured
 * active-button geometry — the pill is the highlight; the active button
 * carries no styling of its own). A controlled component: the caller owns
 * the value and the `onChange` behavior (the no-op-on-current guard is the
 * caller's). The pill's travel runs a back-out easing (a slight overshoot
 * that settles into the measured stand — the end position stands exact,
 * the overshoot is the animation only).
 */
import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { cn } from "./cn";

interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** The icon stand (the icon size's option); the text size's options render the label. */
  icon?: ReactNode;
}

type SegmentSelectorSize = "icon" | "text";

interface PillGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
}

function SegmentSelector<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  slot,
  pillSlot,
  buttonAttrName,
  size = "icon",
}: {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  /** The group's data-slot. */
  slot: string;
  /** The sliding pill's data-slot. */
  pillSlot: string;
  /** The per-button data attribute name (rendered as `data-{name}={value}`). */
  buttonAttrName: string;
  /** The button's stand: `icon` (the size-6 icon seat, the default) or
   * `text` (the text label's stand — the compact h-6 label button). */
  size?: SegmentSelectorSize;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  /** The sliding pill's geometry (the active button's position and size in the list). */
  const [pill, setPill] = useState<PillGeometry | null>(null);

  // Measure the active button before paint (no first-mount flash) and on
  // every list resize (a font or theme change). The reference-equality
  // guard keeps the state stable across re-renders.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list === null) return;
    const measure = (): void => {
      const button = list.querySelector<HTMLElement>(`[data-${buttonAttrName}="${value}"]`);
      if (button === null) return;
      const listRect = list.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      const next = {
        left: buttonRect.left - listRect.left,
        top: buttonRect.top - listRect.top,
        width: buttonRect.width,
        height: buttonRect.height,
      };
      setPill((prev) =>
        prev !== null &&
        prev.left === next.left &&
        prev.top === next.top &&
        prev.width === next.width &&
        prev.height === next.height
          ? prev
          : next
      );
    };
    measure();
    // jsdom (and SSR) have no ResizeObserver — the measurement on mount and
    // on every value change still runs; the resize watch is a browser bonus.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [value, buttonAttrName]);

  const selectOption = (value: (typeof options)[number]["value"]) => () => onChange(value);

  return (
    <div
      ref={listRef}
      role="group"
      aria-label={ariaLabel}
      data-slot={slot}
      className="relative inline-flex items-center rounded-lg bg-muted p-0.75 text-muted-foreground"
    >
      {pill !== null && (
        <span
          data-slot={pillSlot}
          aria-hidden
          // The pill's background stands the standard `accent` token (the
          // soft-highlight — the `background`'s stand was the dark theme's
          // near-black, darker than the track's `muted` and "gloomy"); the
          // neutral theme's `accent` == `muted` (the track), so the dark's
          // pill blends with the track — the dark's stand takes the `ring`
          // token's brighter stand (it reads over the track, and the active
          // icon's `text-foreground` reads over it — the token's own contrast,
          // the consumer's theme or the fallback literal).
          className="
            absolute top-0 left-0 rounded-md bg-accent shadow-sm transition-[transform,width,height] duration-200
            ease-[cubic-bezier(0.34,1.56,0.64,1)]
            dark:bg-ring
          "
          style={{
            transform: `translate(${pill.left}px, ${pill.top}px)`,
            width: pill.width,
            height: pill.height,
          }}
        />
      )}
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          {...{ [`data-${buttonAttrName}`]: option.value }}
          aria-pressed={value === option.value}
          aria-label={option.label}
          title={option.label}
          className={cn(
            `
              relative z-10 flex items-center justify-center rounded-md transition-colors
              focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1
              focus-visible:outline-ring
            `,
            size === "icon" ? "size-6" : "h-6 px-2 text-xs",
            value === option.value ? "text-foreground" : "hover:text-foreground"
          )}
          onClick={selectOption(option.value)}
        >
          {size === "text" ? option.label : option.icon}
        </button>
      ))}
    </div>
  );
}

export { SegmentSelector };
export type { SegmentOption, SegmentSelectorSize };
