/** The many value's chips stand (the multi-enum / the row-links): the train
 * of the option labels over the cell. */
import { cn } from "../../../shared/ui/cn";
import { OPTION_CHIP_INK } from "./constants";
import type { RefOption } from "./models";

function RefValueChips({ values, options, fade }: { values: string[]; options: RefOption[]; fade?: boolean }) {
  // The many value's stand (the multi's): the overflowing train's right edge
  // stands the fade (the `data-fade`'s mask — the chips clip without the
  // ellipsis); the chip stands its text's natural width (the shrink stands
  // none — the train overflows and the fade stands, the chip's text never
  // compresses). The single's stand (the fade stands none) keeps the chip's
  // ellipsis over the long label (the text's stand).
  if (values.length === 0) return null;
  return (
    <span
      data-slot="docblocks/database-ref-chips"
      data-fade={fade ? "true" : undefined}
      className="flex w-full flex-nowrap items-center gap-1 overflow-hidden px-1 text-(length:--docblocks-font-size)"
    >
      {values.map((value) => {
        const option = options.find((entry) => entry.value === value);
        return (
          <span
            key={value}
            data-slot="docblocks/database-ref-chip"
            data-option-value={value}
            style={option?.color !== undefined ? { backgroundColor: option.color, color: OPTION_CHIP_INK } : undefined}
            className={cn(
              "overflow-hidden rounded-(--docblocks-radius) px-1.5 leading-5 whitespace-nowrap",
              fade ? "shrink-0" : "max-w-full shrink text-ellipsis",
              option?.color === undefined && "bg-muted"
            )}
          >
            {option?.label ?? value}
          </span>
        );
      })}
    </span>
  );
}

export { RefValueChips };
