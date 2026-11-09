/** The motion's enum's options editor: the framer `Reorder`'s rows (the
 * grip's press-drag stands the live reorder with the layout's slide — the
 * rows' positions animate over the drag / the commit). The base's stand
 * stands the plain editor (the pointer's session — no animation); this
 * variant is provided over the `EnumOptionsMotionSlot`'s context by the
 * Editor (the framer-motion's required peer). */
import { Reorder, useDragControls } from "framer-motion";
import { useTranslation } from "react-i18next";

import { useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { ENUM_OPTION_PALETTE } from "../database";
import type { EnumOptionDraft } from "../database";
import { Button } from "../shared/ui/Button";
import { ColorSwatches } from "../shared/ui/ColorSwatches";
import { Input } from "../shared/ui/Input";
import { Popover, PopoverContent, PopoverTrigger } from "../shared/ui/Popover";
import { GripVertical, X } from "../shared/ui/icons";
import { TRANSITION } from "./constants";

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
  const { t } = useTranslation("database");
  const dragControls = useDragControls();
  const onGripPointerDown = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragControls.start(event);
  };
  const onSelectColor = (hex: string) => {
    onSet({ color: hex });
    onColorOpen(false); // the pick's stand: the palette's close
  };
  const onSelectNone = () => {
    onSet({ color: null });
    onColorOpen(false);
  };
  const onNameChange = (event: React.ChangeEvent<HTMLInputElement>) => onSet({ name: event.target.value });
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
        onPointerDown={onGripPointerDown}
        className="
          flex size-5 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground
          active:cursor-grabbing
        "
      >
        <GripVertical className="size-3.5" />
      </span>
      <Popover open={colorOpen} onOpenChange={onColorOpen}>
        <PopoverTrigger asChild>
          <Button
            data-slot="docblocks/database-enum-option-color"
            variant="ghost"
            data-color={option.color ?? ""}
            title={t("enum.optionColor")}
            className="size-4 shrink-0 cursor-pointer rounded-full border border-border p-0 focus-visible:ring-0"
            style={option.color !== null ? { backgroundColor: option.color } : undefined}
          />
        </PopoverTrigger>
        <PopoverContent className="flex items-center p-2">
          <ColorSwatches
            colors={ENUM_OPTION_PALETTE}
            current={option.color ?? undefined}
            label={t("enum.optionColorAria")}
            allowNone
            noneActive={option.color === null}
            onSelect={onSelectColor}
            onSelectNone={onSelectNone}
          />
        </PopoverContent>
      </Popover>
      <Input
        size="sm"
        type="text"
        data-slot="docblocks/database-enum-option-name"
        placeholder={t("enum.optionPlaceholder")}
        className="min-w-0 flex-1 cursor-text text-foreground focus:bg-muted/60"
        value={option.name}
        onChange={onNameChange}
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
        onClick={onRemove}
      >
        <X className="size-3.5" />
      </Button>
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
  const { t } = useTranslation("database");
  const [colorOpen, setColorOpen] = useState<number | null>(null);

  const setOption = (index: number, patch: Partial<EnumOptionDraft>) => {
    onChange(options.map((option, i) => (i === index ? { ...option, ...patch } : option)));
  };

  const colorOpenChange = (index: number) => (open: boolean) => setColorOpen(open ? index : null);
  const setOptionAt = (index: number) => (patch: Partial<EnumOptionDraft>) => setOption(index, patch);
  const optionRemove = (index: number) => () => onChange(options.filter((_, i) => i !== index));
  const addOption = () => onChange([...options, { name: "", color: null, uid: Math.random().toString(36).slice(2) }]);

  return (
    <div data-slot="docblocks/database-enum-options" className="flex flex-col gap-1">
      <div className="text-sm text-foreground">{t("enum.options")}</div>
      <Reorder.Group axis="y" values={options} onReorder={onChange} className="flex flex-col gap-1">
        {options.map((option, index) => (
          <MotionEnumOptionRow
            key={option.rowId ?? option.uid ?? `draft-${index}`}
            option={option}
            colorOpen={colorOpen === index}
            onColorOpen={colorOpenChange(index)}
            onSet={setOptionAt(index)}
            onRemove={optionRemove(index)}
          />
        ))}
      </Reorder.Group>
      <Button
        data-slot="docblocks/database-enum-option-add"
        variant="ghost"
        size="sm"
        className="h-auto cursor-pointer self-start rounded-sm px-1 py-0.5 font-normal text-muted-foreground"
        onClick={addOption}
      >
        {t("enum.addOption")}
      </Button>
    </div>
  );
}

export { MotionEnumOptionsEditor };
