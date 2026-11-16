/** The attribute row's frame: the fixed label column + the value zone +
 *  the optional remove button. The label and the value share the font
 *  size (the value's zone keeps its own padding — the column's stand).
 *  The label's stand is a plain string (the display) or a node (the
 *  rename's entry / the rename's input over the custom rows). */
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
  children: ReactNode;
}) {
  return (
    <div
      data-slot="docblocks/attribute-row"
      data-attribute-key={attributeKey}
      className="flex min-h-11 items-center gap-3 py-1.5"
    >
      <span className={cn("w-28 shrink-0 truncate text-sm text-muted-foreground", topAlign && "mt-1.5 self-start")}>
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
          className={cn("size-6 shrink-0 text-muted-foreground hover:text-foreground", topAlign && "mt-1 self-start")}
          onClick={onRemove}
        >
          <Trash className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

export { AttributeRow };
