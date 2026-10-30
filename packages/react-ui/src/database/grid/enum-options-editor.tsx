/** The enum's options editor (the create / the edit's form stand): the
 * option's rows over the draft (the grip's press-drag stands the live
 * reorder — the draft's pure stand, no bridge write until the form's
 * commit; the color's swatch stands the palette's popover — the hex
 * stands the data; the name's input; the delete's control) + the
 * add-option's entry. The row's pitch stands the drag's index math
 * (the 32 px row + the 4 px gap = the 36 px pitch). */
import { useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { Button } from "../../shared/ui/Button";
import { ColorSwatches } from "../../shared/ui/ColorSwatches";
import { Input } from "../../shared/ui/Input";
import { Popover, PopoverContent, PopoverTrigger } from "../../shared/ui/Popover";
import { GripVertical, X } from "../../shared/ui/icons";
import { ENUM_OPTION_PALETTE } from "../bridge";
import type { EnumOptionDraft } from "./models";

function EnumOptionsEditor({
  options,
  onChange,
}: {
  options: EnumOptionDraft[];
  onChange: (next: EnumOptionDraft[]) => void;
}) {
  const [colorOpen, setColorOpen] = useState<number | null>(null);

  const setOption = (index: number, patch: Partial<EnumOptionDraft>) => {
    onChange(options.map((option, i) => (i === index ? { ...option, ...patch } : option)));
  };

  /** The grip's drag session (the window-level pointer stand — the capture
   *  would retarget the presses): the live reorder over the draft's stand
   *  (the release stands nothing extra — the draft IS the order). The
   *  pitch stands measured (the row's own box + the group's row-gap —
   *  the stand is layout-driven, not a constant). */
  const beginGripDrag = (index: number) => (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const gripEl = event.currentTarget as HTMLElement;
    const rowEl = gripEl.closest<HTMLElement>('[data-slot="docblocks/database-enum-option-row"]');
    const groupEl = gripEl.closest<HTMLElement>('[data-slot="docblocks/database-enum-options"]');
    const measured =
      rowEl !== null && groupEl !== null
        ? rowEl.getBoundingClientRect().height + Number.parseFloat(getComputedStyle(groupEl).rowGap)
        : Number.NaN;
    const pitch = Number.isFinite(measured) && measured > 0 ? measured : 36;
    const startY = event.clientY;
    let current = options;
    const move = (pointer: PointerEvent) => {
      const delta = Math.round((pointer.clientY - startY) / pitch);
      const target = Math.min(current.length - 1, Math.max(0, index + delta));
      if (target !== index) {
        const next = [...current];
        const [moved] = next.splice(index, 1);
        if (moved === undefined) return;
        next.splice(target, 0, moved);
        current = next;
        onChange(next);
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div data-slot="docblocks/database-enum-options" className="flex flex-col gap-1">
      <div className="text-sm text-foreground">Options</div>
      {options.map((option, index) => (
        <div
          key={option.rowId ?? option.uid ?? `draft-${index}`}
          data-slot="docblocks/database-enum-option-row"
          className="flex h-8 items-center gap-1"
        >
          <span
            data-slot="docblocks/database-enum-option-grip"
            onPointerDown={beginGripDrag(index)}
            className="
              flex size-5 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground
              active:cursor-grabbing
            "
          >
            <GripVertical className="size-3.5" />
          </span>
          <Popover open={colorOpen === index} onOpenChange={(open) => setColorOpen(open ? index : null)}>
            <PopoverTrigger asChild>
              <Button
                data-slot="docblocks/database-enum-option-color"
                variant="ghost"
                data-color={option.color ?? ""}
                title="Option's color"
                className="size-4 shrink-0 cursor-pointer rounded-full border border-border focus-visible:ring-0"
                style={option.color !== null ? { backgroundColor: option.color } : undefined}
              />
            </PopoverTrigger>
            <PopoverContent className="flex items-center p-2">
              {/* The shared color's palette (the format's / the shape's
                  toolbars' stand): the hex's resolve over the press (the
                  data stands the hex, never the token), the none's stand
                  over the transparent's swatch. */}
              <ColorSwatches
                colors={ENUM_OPTION_PALETTE}
                current={option.color ?? undefined}
                label="option color"
                allowNone
                noneActive={option.color === null}
                onSelect={(hex) => setOption(index, { color: hex })}
                onSelectNone={() => setOption(index, { color: null })}
              />
            </PopoverContent>
          </Popover>
          <Input
            size="sm"
            type="text"
            data-slot="docblocks/database-enum-option-name"
            placeholder="Option"
            className="min-w-0 flex-1 cursor-text text-foreground focus:bg-muted/60"
            value={option.name}
            onChange={(event) => setOption(index, { name: event.target.value })}
          />
          <Button
            data-slot="docblocks/database-enum-option-delete"
            variant="ghost"
            size="icon"
            className="
              size-5 shrink-0 cursor-pointer text-muted-foreground
              hover:bg-transparent hover:text-foreground
              dark:hover:bg-transparent
            "
            onClick={() => onChange(options.filter((_, i) => i !== index))}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ))}
      <Button
        data-slot="docblocks/database-enum-option-add"
        variant="ghost"
        size="sm"
        className="h-auto cursor-pointer self-start rounded-sm px-1 py-0.5 font-normal text-muted-foreground"
        onClick={() => onChange([...options, { name: "", color: null, uid: Math.random().toString(36).slice(2) }])}
      >
        + Add option
      </Button>
    </div>
  );
}

export { EnumOptionsEditor };
