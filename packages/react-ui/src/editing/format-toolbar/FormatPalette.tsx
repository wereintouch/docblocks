/** The format toolbar's COLOR palette (the non-modal popover): the target
 * switch (the text's `color` mark vs the background's `highlight` mark)
 * over the shared palette (the editor's `formatPalette` prop's eight
 * swatches) plus the reset's entry. The popover is portaled to the
 * document body (radix) and — like the bar — suppresses the default
 * mousedown so the editor's text selection stays alive while a swatch is
 * picked; the outside dismiss (pointer and focus) is suppressed the same
 * way the bar is not dismissed by its own buttons (the selection state
 * owns the visibility). The text's target stands the reset's cross over
 * the all colors (the elements' palettes keep the transparent's "no
 * color" swatch). */
import { useTranslation } from "react-i18next";

import { Button } from "../../shared/ui/Button";
import { ColorChip } from "../../shared/ui/ColorChip";
import { ColorSwatches } from "../../shared/ui/ColorSwatches";
import { Popover, PopoverContent, PopoverTrigger } from "../../shared/ui/Popover";
import { cn } from "../../shared/ui/cn";
import { Baseline } from "../../shared/ui/icons";
import { preventDefault } from "../../shared/utils";
import { ACTIVE_ITEM_CLASS, MENU_SIDE_OFFSET_PX } from "./constants";
import type { PaletteTarget } from "./models";

interface FormatPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The palette's target (the text's `color` / the background's `highlight`). */
  target: PaletteTarget;
  onTargetChange: (target: PaletteTarget) => void;
  /** The palette's swatch's pick (the value or the clear; the close's stand). */
  onValue: (value: string | null) => void;
  /** The editor's format palette (the formatPalette prop's stand). */
  palette: readonly string[];
  /** The swatch's active stand (the range's uniform value over the target). */
  paletteActive: (value: string | null) => boolean;
  /** The current uniform value (the swatch's seat — "mixed" matches none). */
  currentMarkValue: string | "mixed" | null;
  /** The trigger's chip preview (the uniform hex; the X over the absent / the mixed). */
  chipValue: string | null;
}

function FormatPalette({
  open,
  onOpenChange,
  target,
  onTargetChange,
  onValue,
  palette,
  paletteActive,
  currentMarkValue,
  chipValue,
}: FormatPaletteProps) {
  const { t } = useTranslation("editor");
  return (
    <Popover modal={false} open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          data-target={target}
          title={t("formatToolbar.color.trigger")}
          aria-label={t("formatToolbar.color.trigger")}
          className="data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"
        >
          <span className="flex items-center gap-1">
            <Baseline className="size-4" />
            <ColorChip value={chipValue} />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={MENU_SIDE_OFFSET_PX}
        data-slot="docblocks/format-palette"
        aria-label={t("formatToolbar.color.trigger")}
        className="w-auto p-2"
        onMouseDown={preventDefault}
        onPointerDownOutside={preventDefault}
        onFocusOutside={preventDefault}
      >
        <div role="group" aria-label={t("formatToolbar.color.targetGroupAria")} className="flex gap-1">
          {(["highlight", "color"] as const).map((option) => (
            <Button
              key={option}
              variant="ghost"
              size="sm"
              data-target-btn={option}
              aria-pressed={target === option}
              aria-label={
                option === "highlight" ? t("formatToolbar.color.highlightAria") : t("formatToolbar.color.textAria")
              }
              title={
                option === "highlight" ? t("formatToolbar.color.highlightAria") : t("formatToolbar.color.textAria")
              }
              className={cn("h-7 flex-1 text-xs", target === option && ACTIVE_ITEM_CLASS)}
              onClick={() => onTargetChange(option)}
            >
              {option === "highlight" ? t("formatToolbar.color.highlightLabel") : t("formatToolbar.color.textLabel")}
            </Button>
          ))}
        </div>
        <ColorSwatches
          colors={palette}
          current={currentMarkValue}
          onSelect={onValue}
          label={target === "highlight" ? t("formatToolbar.palette.highlight") : t("formatToolbar.palette.text")}
          allowNone
          noneActive={paletteActive(null)}
          onSelectNone={() => onValue(null)}
          // The text's palette's reset's stand: the cross's button over
          // the all colors (the elements' palettes keep the
          // transparent's "no color" swatch).
          noneAsCross
        />
      </PopoverContent>
    </Popover>
  );
}

export { FormatPalette };
export type { FormatPaletteProps };
