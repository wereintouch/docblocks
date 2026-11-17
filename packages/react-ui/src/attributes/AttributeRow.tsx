/** The attribute row's frame: the fixed label column + the value zone +
 *  the optional remove button. The label and the value share the font
 *  size (the value's zone keeps its own padding — the column's stand).
 *  The label's stand is a plain string (the display) or a node (the
 *  rename's entry / the rename's input over the custom rows); the
 *  column's clip stands off over the `labelClassName`'s override (the
 *  rename's input's frame's overhang over the column's edge). */
import type { ReactNode } from "react";

import { Button } from "../shared/ui/Button";
import { cn } from "../shared/ui/cn";
import { Trash } from "../shared/ui/icons";

function AttributeRow({
  attributeKey,
  label,
  removable,
  onRemove,
  removeAria,
  topAlign,
  labelClassName,
  children,
}: {
  attributeKey: string;
  label: ReactNode;
  removable: boolean;
  onRemove?: () => void;
  removeAria?: string;
  /** The label stands opposite the FIRST line over the multi-line value
   *  zone (the list's stack) — the row's center stand dropped. */
  topAlign?: boolean;
  /** The label column's extra class (the last word over the column's
   *  base — the rename's input's frame's overhang stands the column's
   *  clip's no-stand). */
  labelClassName?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-slot="docblocks/attribute-row"
      data-attribute-key={attributeKey}
      className="flex min-h-11 items-center gap-3 py-1.5"
    >
      <span
        className={cn(
          // The column stands the longest's locale label (the
          // publishedAt's date key over the 14 px's Inter — the w-28's
          // 112 px stood the truncate's stand over the Russian's locale).
          "w-32 shrink-0 truncate text-sm text-muted-foreground",
          topAlign && "mt-1.5 self-start",
          labelClassName
        )}
      >
        {label}
      </span>
      {/* The zone's flex's stand (the content's vertical center): the zone
        inherits the page's line-height (the 16px's stand over the shared
        editable), so a block container over an inline-block's editor grows
        over the line box and stands the value's text above the label's
        center. */}
      <div className="flex min-w-0 flex-1 items-center">{children}</div>
      {removable && onRemove !== undefined ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={removeAria ?? attributeKey}
          data-slot="docblocks/attribute-row-remove"
          className={cn(
            // The panel's icon hover stands the panel's band's stand
            // (the ghost's accent stand dropped — the one style's
            // parity over the panel's hovers).
            "size-6 shrink-0 text-muted-foreground hover:bg-muted/50 hover:text-foreground dark:hover:bg-muted/50",
            topAlign && "mt-1 self-start"
          )}
          onClick={onRemove}
        >
          <Trash className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

export { AttributeRow };
