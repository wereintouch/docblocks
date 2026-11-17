/**
 * The color chip's preview — the trigger's current-color stand, the shared
 * language over every color trigger (the page's format buttons, the canvas
 * toolbars, the table's handles). The `fill` mode's square is filled with
 * the current hex; the `stroke` mode's square is hollow with the current
 * hex's border (the stroke's preview). The none's stand is the X over the
 * theme's muted frame. The frame's border reads the canvas chrome's token
 * over the canvas toolbars and the standard's `--border` elsewhere (the
 * token's fallback).
 */
import { cn } from "./cn";
import { X } from "./icons";

type ColorChipProps = {
  /** The current's value (the hex), or the absent (the none's stand). */
  value?: string | null;
  /** The preview's mode: the fill's background (the default) or the
   * stroke's hollow border. */
  mode?: "fill" | "stroke";
  className?: string;
};

function ColorChip({ value, mode = "fill", className }: ColorChipProps) {
  const none = value === undefined || value === null || value === "";
  const stroke = mode === "stroke" && !none;
  return (
    <span
      data-slot="docblocks/color-chip"
      className={cn("relative size-3 shrink-0 rounded-(--docblocks-radius)", className)}
      style={
        none
          ? { border: "1px solid var(--docblocks-formatbar-border-color, var(--border, #888))" }
          : stroke
            ? { border: `2px solid ${value}` }
            : { background: value, border: "1px solid var(--docblocks-formatbar-border-color, var(--border, #888))" }
      }
      aria-hidden
    >
      {none && <X className="absolute inset-0 m-auto size-2.5 text-muted-foreground" strokeWidth={2.5} aria-hidden />}
    </span>
  );
}

export { ColorChip };
