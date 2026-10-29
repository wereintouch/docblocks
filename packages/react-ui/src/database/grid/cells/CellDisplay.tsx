/** The cell's read-only display (the single-press stand: the value text or
 *  the empty stand). */
import { cn } from "../../../shared/ui/cn";

/** The cell's read-only display (the single-press stand): the value text
 *  or the empty stand (the content-less cell is empty — no placeholder, no
 *  trigger chrome). */
function CellDisplay({
  text,
  alignRight,
  ...props
}: {
  text: string;
  /** The number column's right align (the type's contract — the value and
   * the overflow's ellipsis stand the right edge). */
  alignRight?: boolean;
} & React.ComponentPropsWithoutRef<"span"> & { ref?: React.Ref<HTMLSpanElement> }) {
  // The read-only display stands one line (no wrap): the overflowing text
  // ends with the ellipsis (the multi-ref's stand stands the right fade
  // instead — the `RefValueChips`' own stand, not this text's). The number's
  // stand is the right align (the column's type's contract — the overflow's
  // ellipsis stands the left edge over the right-aligned text, the
  // browser's own stand).
  return (
    <span
      data-slot="docblocks/database-cell-display"
      className={cn("block w-full truncate px-1 text-(length:--docblocks-font-size)", alignRight && "text-right")}
      {...props}
    >
      {text === "" ? null : text}
    </span>
  );
}

export { CellDisplay };
