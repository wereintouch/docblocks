/**
 * The callout's management affordance — the marker-zone icon stands a
 * button; its click opens the block's management menu (the type presets /
 * the background palette over the custom picker / the icon catalog) beside
 * the icon. The menu manages the block's attrs, not the selection's marks,
 * so it stands for an empty callout (no text selection needed). The
 * read-only stands (view / published) render the icon without a button —
 * no pointer events, the editing-surface parity.
 *
 * The menu is a non-modal portaled popover: the content's mousedown guard
 * keeps the editor's text selection alive over the open (the format
 * toolbar's menu parity — the guard yields over the picker's inputs, their
 * focus stands the gesture). The pick's stand closes the menu over the
 * color and the icon's apply (the type preset stays open). The custom
 * swatch's press toggles the picker's inline section over the menu's
 * background row; a close without an explicit commit (the Esc / the
 * dismiss) applies the last scrubbed value (the picker's unmount commits
 * it; the grid's custom swatch carries a non-preset current value as its
 * own dot).
 */
import { useTranslation } from "react-i18next";

import { useCallback, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";

import { CALLOUT_ICONS } from "docblocks-core";
import type { Block, BlockId } from "docblocks-core";

import { useEditorContext } from "../editor-provider";
import { useFormatPalette } from "../shared/providers/format-palette-context";
import { Button } from "../shared/ui/Button";
import { ColorPicker } from "../shared/ui/ColorPicker";
import { ColorSwatches } from "../shared/ui/ColorSwatches";
import { Popover, PopoverContent, PopoverTrigger } from "../shared/ui/Popover";
import { cn } from "../shared/ui/cn";
import { preventDefault } from "../shared/utils";
import { CALLOUT_ICON_COMPONENTS, CALLOUT_PRESET_ICONS, calloutIconName } from "./callout-icon";

interface CalloutBlockMenuProps {
  id: BlockId;
  block: Extract<Block, { type: "callout" }>;
}

function CalloutBlockMenu({ id, block }: CalloutBlockMenuProps) {
  const { t } = useTranslation("editor");
  const { doc, viewMode } = useEditorContext();
  const palette = useFormatPalette();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const variant = block.attrs?.variant ?? "info";
  const color = block.attrs?.color ?? null;
  const icon = block.attrs?.icon ?? null;
  const effectiveIcon = calloutIconName(icon, variant);
  const Icon = CALLOUT_ICON_COMPONENTS[effectiveIcon];
  const borderColor =
    typeof color === "string" && color !== "" ? color : `var(--docblocks-callout-border-color-${variant})`;

  // The type (preset) switch is one transact (the variant + the overrides
  // reset to null — the preset resets the individual overrides); the color
  // / icon are individual overrides (the variant stands — the preset
  // identity is kept). A no-op stand writes nothing (one action is one
  // updateBlock: one undo step, one wire update).
  const onPreset = (next: "info" | "warning" | "danger"): void => {
    if (variant === next && color === null && icon === null) return; // no-op
    doc.transact(() => doc.updateBlock(id, { variant: next, color: null, icon: null }));
  };

  const onColorPick = (hex: string): void => {
    setMenuOpen(false); // the pick's stand: the menu's close
    if (color === hex) return; // no-op
    doc.updateBlock(id, { color: hex });
  };

  const onColorNone = (): void => {
    setMenuOpen(false);
    if (color === null) return; // no-op
    doc.updateBlock(id, { color: null });
  };

  const onColorCommit = (hex: string): void => {
    if (color === hex) return; // no-op (the picker's own guard stands)
    doc.updateBlock(id, { color: hex });
  };

  const onIconPick = (name: string): void => {
    setMenuOpen(false);
    if (icon === name) return; // no-op
    doc.updateBlock(id, { icon: name });
  };

  // Keep a mousedown on the icon from moving the text caret (the selection
  // stands alive over the open — the gutter controls' parity).
  const onControlMouseDown = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
  }, []);

  // The icon's zone: vertically centered over the block (the first-line's
  // top-align stood before — the multi-line callout's icon floated over the
  // text's start).
  const iconStyle: CSSProperties = {
    top: "50%",
    transform: "translateY(-50%)",
    left: "var(--docblocks-callout-padding-x)",
    width: "var(--docblocks-callout-icon-size)",
    height: "var(--docblocks-callout-icon-size)",
    color: borderColor,
  };

  // The read-only stand: the icon without a button (no pointer events).
  if (viewMode) {
    return (
      <span
        data-slot="docblocks/callout-icon"
        aria-hidden
        className="pointer-events-none absolute flex items-center justify-center"
        style={iconStyle}
      >
        {Icon !== undefined && <Icon style={{ width: "100%", height: "100%" }} />}
      </span>
    );
  }

  return (
    <span
      data-slot="docblocks/callout-icon"
      className="absolute flex items-center justify-center"
      style={iconStyle}
      contentEditable={false}
    >
      <Popover
        modal={false}
        open={menuOpen}
        onOpenChange={(next) => {
          setMenuOpen(next);
          setPickerOpen(false);
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-slot="docblocks/callout-icon-button"
            aria-label={t("formatToolbar.callout.iconAria")}
            aria-haspopup="true"
            aria-expanded={menuOpen}
            onMouseDown={onControlMouseDown}
            className="size-full rounded-full p-0 data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"
          >
            {Icon !== undefined && <Icon style={{ width: "100%", height: "100%" }} />}
          </Button>
        </PopoverTrigger>
        {/* The content's mousedown guard keeps the editor's text selection
          alive over the open. It yields over the picker's inputs (their
          focus stands the gesture — a default suppression would keep the
          field unfocusable). The outside pointer dismiss stands (a page
          click is a normal editing gesture — the menu yields). */}
        <PopoverContent
          align="start"
          sideOffset={4}
          data-slot="docblocks/callout-menu"
          className="w-auto p-2"
          onMouseDown={(event) => {
            const target = event.target;
            if (target instanceof HTMLElement && target.closest("input, textarea") !== null) return;
            preventDefault(event);
          }}
        >
          {/* Type (the preset: the variant + the overrides reset to the
            preset — one transact). */}
          <div role="group" aria-label={t("formatToolbar.callout.typeAria")} className="flex gap-1">
            {(["info", "warning", "danger"] as const).map((preset) => {
              const active = variant === preset;
              const PresetIcon = CALLOUT_ICON_COMPONENTS[CALLOUT_PRESET_ICONS[preset]];
              return (
                <Button
                  key={preset}
                  variant="ghost"
                  size="sm"
                  data-callout-type-btn={preset}
                  aria-pressed={active}
                  aria-label={t("formatToolbar.callout.variant", { variant: preset })}
                  title={t("formatToolbar.callout.variant", { variant: preset })}
                  className={cn("h-7", active && "bg-accent text-accent-foreground")}
                  onClick={() => onPreset(preset)}
                >
                  {PresetIcon !== undefined && <PresetIcon className="size-4" />}
                </Button>
              );
            })}
          </div>
          {/* Background (the override; the transparent swatch = the preset,
            the custom swatch = the picker's inline section). */}
          <div className="mt-2 border-t border-border pt-2">
            <ColorSwatches
              colors={palette}
              current={color}
              onSelect={onColorPick}
              label={t("formatToolbar.palette.callout")}
              allowNone
              noneActive={color === null}
              onSelectNone={onColorNone}
              allowCustom
              onCustom={() => setPickerOpen((prev) => !prev)}
            />
            {pickerOpen && (
              <div data-slot="docblocks/callout-color-picker" className="mt-2 border-t border-border pt-2">
                <ColorPicker value={color} onCommit={onColorCommit} onClose={() => setMenuOpen(false)} />
              </div>
            )}
          </div>
          {/* Icon (the catalog grid; the type preset resets the override). */}
          <div className="mt-2 border-t border-border pt-2">
            <div role="group" aria-label={t("formatToolbar.callout.iconAria")} className="grid grid-cols-6 gap-1">
              {CALLOUT_ICONS.map((name) => {
                const IconComponent = CALLOUT_ICON_COMPONENTS[name];
                const active = calloutIconName(icon, variant) === name;
                if (IconComponent === undefined) return null; // the drift test keeps this in step
                return (
                  <Button
                    key={name}
                    variant="ghost"
                    size="icon"
                    data-callout-icon-btn={name}
                    aria-pressed={active}
                    aria-label={`${name} icon`}
                    title={name}
                    className={cn("size-7", active && "bg-accent text-accent-foreground")}
                    onClick={() => onIconPick(name)}
                  >
                    <IconComponent className="size-4" />
                  </Button>
                );
              })}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </span>
  );
}

export { CalloutBlockMenu };
export type { CalloutBlockMenuProps };
