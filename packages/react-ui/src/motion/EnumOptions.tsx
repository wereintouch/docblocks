/** The motion's enum's options editor: the framer `Reorder`'s rows (the
 * grip's press-drag stands the live reorder with the layout's slide — the
 * rows' positions animate over the drag / the commit). The base's stand
 * stands the plain editor (the pointer's session — no animation); this
 * variant is provided over the `EnumOptionsMotionSlot`'s context by the
 * `MotionEditor` (the framer's import stands this subpath only — the
 * house's boundary's contract). */
import { Reorder, useDragControls } from "framer-motion";

import { useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { ENUM_OPTION_PALETTE } from "../database";
import type { EnumOptionDraft } from "../database";
import { ColorSwatches } from "../shared/ui/ColorSwatches";
import { Popover, PopoverContent, PopoverTrigger } from "../shared/ui/Popover";
import { GripVertical, X } from "../shared/ui/icons";
import { TRANSITION } from "./models";

interface MotionEnumOptionRowProps {
  option: EnumOptionDraft;
  colorOpen: boolean;
  onColorOpen: (open: boolean) => void;
  onSet: (patch: Partial<EnumOptionDraft>) => void;
  onRemove: () => void;
}
/** One option's row as a `Reorder.Item` (the grip's press starts the
 *  framer's drag through the row's `dragControls` — the grip is the only
 *  drag trigger, the row's own drag is disarmed). */
function MotionEnumOptionRow({ option, colorOpen, onColorOpen, onSet, onRemove }: MotionEnumOptionRowProps) {
  const dragControls = useDragControls();
  return (
    <Reorder.Item
      as="div"
      data-slot="docblocks/database-enum-option-row"
      value={option}
      dragListener={false}
      dragControls={dragControls}
      whileDrag={{ zIndex: 10 }}
      layout="position"
      transition={{ layout: TRANSITION }}
      className="relative flex h-8 items-center gap-1"
    >
      <span
        data-slot="docblocks/database-enum-option-grip"
        onPointerDown={(event: ReactPointerEvent<HTMLSpanElement>) => {
          if (event.button !== 0) return;
          event.preventDefault();
          dragControls.start(event);
        }}
        className="
          flex size-5 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground
          active:cursor-grabbing
        "
      >
        <GripVertical className="size-3.5" />
      </span>
      <Popover open={colorOpen} onOpenChange={onColorOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-slot="docblocks/database-enum-option-color"
            data-color={option.color ?? ""}
            title="Option's color"
            className="size-4 shrink-0 cursor-pointer rounded-full border border-border"
            style={option.color !== null ? { backgroundColor: option.color } : undefined}
          />
        </PopoverTrigger>
        <PopoverContent className="flex items-center p-2">
          <ColorSwatches
            colors={ENUM_OPTION_PALETTE}
            current={option.color ?? undefined}
            label="option color"
            allowNone
            noneActive={option.color === null}
            onSelect={(hex) => onSet({ color: hex })}
            onSelectNone={() => onSet({ color: null })}
          />
        </PopoverContent>
      </Popover>
      <input
        type="text"
        data-slot="docblocks/database-enum-option-name"
        placeholder="Option"
        className="
          w-full min-w-0 flex-1 cursor-text rounded-md border border-border bg-transparent px-2 text-sm text-foreground
          outline-none
          focus:bg-muted/60
        "
        value={option.name}
        onChange={(event) => onSet({ name: event.target.value })}
      />
      <button
        type="button"
        data-slot="docblocks/database-enum-option-delete"
        className="
          flex size-5 shrink-0 cursor-pointer items-center justify-center text-muted-foreground outline-none
          hover:text-foreground
        "
        onClick={onRemove}
      >
        <X className="size-3.5" />
      </button>
    </Reorder.Item>
  );
}

/** The motion's options' editor (the create / the edit's form's stand):
 *  the `Reorder.Group`'s live reorder over the draft (the release stands
 *  nothing extra — the draft IS the order; the form's commit stands the
 *  bridge's write over the system's table). */
function MotionEnumOptionsEditor({
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

  return (
    <div data-slot="docblocks/database-enum-options" className="flex flex-col gap-1">
      <div className="text-sm text-foreground">Options</div>
      <Reorder.Group axis="y" values={options} onReorder={onChange} className="flex flex-col gap-1">
        {options.map((option, index) => (
          <MotionEnumOptionRow
            key={option.rowId ?? option.uid ?? `draft-${index}`}
            option={option}
            colorOpen={colorOpen === index}
            onColorOpen={(open) => setColorOpen(open ? index : null)}
            onSet={(patch) => setOption(index, patch)}
            onRemove={() => onChange(options.filter((_, i) => i !== index))}
          />
        ))}
      </Reorder.Group>
      <button
        type="button"
        data-slot="docblocks/database-enum-option-add"
        className="
          cursor-pointer self-start rounded-sm px-1 py-0.5 text-sm text-muted-foreground outline-none
          hover:bg-accent hover:text-accent-foreground
        "
        onClick={() => onChange([...options, { name: "", color: null, uid: Math.random().toString(36).slice(2) }])}
      >
        + Add option
      </button>
    </div>
  );
}

export { MotionEnumOptionsEditor };
