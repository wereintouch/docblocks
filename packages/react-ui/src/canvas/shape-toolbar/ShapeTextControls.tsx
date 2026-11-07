/**
 * The shared text controls of the canvas's text toolbars (the shape's and
 * the canvas-text's): the font-family dropdown (the self-hosted set — an
 * unrecognized name stands the raw name), the text color section, the
 * text-style dropdown (the weight x the slant), the size input (any 8–512
 * stand, the datalist's hints), and the align buttons. Each apply is the
 * `onApply`'s patch (the caller's one `updateBlock` in one transact). The
 * `slotPrefix` stands the data-slot's namespace (the shape's
 * `docblocks/shape-toolbar-*`, the canvas-text's
 * `docblocks/canvas-text-toolbar-*`).
 */
import type { ChangeEvent, KeyboardEvent } from "react";
import { useEffect, useState } from "react";

import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Input,
} from "../../shared/ui";
import { Datalist } from "../../shared/ui/Datalist";
import { cn } from "../../shared/ui/cn";
import { Italic, Palette, TextAlignCenter, TextAlignEnd, TextAlignStart, Type } from "../../shared/ui/icons";
import { stopPropagation } from "../../shared/utils";
import { SHAPE_FONT_OPTIONS, SHAPE_FONT_SIZE_OPTIONS, SHAPE_TEXT_STYLE_OPTIONS } from "../text-fonts";
import { TOOLTIP_SIDE_OFFSET_PX } from "../viewport/constants";
import { ColorSection } from "./ColorSection";
import { ACTIVE_ITEM_CLASS } from "./constants";

interface ShapeTextControlsProps {
  /** The data-slot's namespace (the shape's `docblocks/shape-toolbar`, the
   * canvas-text's `docblocks/canvas-text-toolbar`). */
  slotPrefix: "docblocks/shape-toolbar" | "docblocks/canvas-text-toolbar";
  /** The size datalist's id key (the target block's id stand). */
  sizeListId: string;
  fontFamily: string | undefined;
  textColor: string | undefined;
  textStyle: string | undefined;
  fontSize: number | undefined;
  textAlign: string | undefined;
  /** The text color section's open state (the caller's — the shape's
   * sections are mutually exclusive, the canvas-text's stands alone). */
  textColorOpen: boolean;
  onTextColorOpenChange: (open: boolean) => void;
  onApply: (patch: Record<string, unknown>) => void;
}

function ShapeTextControls({
  slotPrefix,
  sizeListId,
  fontFamily,
  textColor,
  textStyle,
  fontSize,
  textAlign,
  textColorOpen,
  onTextColorOpenChange,
  onApply,
}: ShapeTextControlsProps) {
  // The color section's namespace (the palette / the hex's base — the
  // toolbar prefix minus its "-toolbar" tail: the shape's `docblocks/shape`,
  // the canvas-text's `docblocks/canvas-text`).
  const colorSlotPrefix = slotPrefix.replace(/-toolbar$/, "");
  // The size field's draft (the typed stand; the attr stands the commit).
  const [sizeDraft, setSizeDraft] = useState("");

  // The font list's preload (the menu's lag stand): the toolbar's mount
  // (the selection's moment — before the font menu's open) fetches the
  // faces; the first open otherwise waits for the network round-trip
  // (the visible jank), and the menu's rows reflow as the face lands
  // (the swap).
  useEffect(() => {
    if (typeof document === "undefined" || typeof document.fonts?.load !== "function") return;
    for (const option of SHAPE_FONT_OPTIONS) {
      void document.fonts.load(`400 16px "${option.id}"`).catch(() => undefined);
    }
  }, []);

  const applyFontFamily = (fontFamilyId: string) => () => onApply({ fontFamily: fontFamilyId });
  const applyTextStyle = (textStyleId: string) => () => onApply({ textStyle: textStyleId });
  const commitSize = () => {
    const value = Number.parseInt(sizeDraft, 10);
    setSizeDraft("");
    if (Number.isNaN(value)) return; // the invalid draft is ignored (the input keeps its text)
    const clamped = Math.min(512, Math.max(8, value));
    if (clamped === fontSize) return;
    onApply({ fontSize: clamped });
  };
  const applyAlign = (value: string) => () => onApply({ textAlign: value });
  const applyTextColor = (value: string) => onApply({ textColor: value });
  const onSizeChange = (event: ChangeEvent<HTMLInputElement>) => setSizeDraft(event.target.value);
  const onSizeKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitSize();
    }
  };

  return (
    <>
      {/* The font family (the self-hosted set; an unrecognized name
          stands the raw name — the consumer's own font by name). */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            data-slot={`${slotPrefix}-font-family`}
            aria-label="Text font family"
            title="Text font family"
          >
            <Type className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={TOOLTIP_SIDE_OFFSET_PX} aria-label="Text font family">
          {SHAPE_FONT_OPTIONS.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.id}
              aria-label={option.label}
              data-font={option.id}
              checked={fontFamily === option.id}
              onSelect={applyFontFamily(option.id)}
            >
              <span className="w-16 truncate text-xs" style={{ fontFamily: option.stack }}>
                {option.label}
              </span>
              {option.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <ColorSection
        target="text"
        label="Text color"
        current={textColor}
        chipStyle={{ background: textColor ?? "transparent" }}
        icon={<Palette className="size-4" />}
        open={textColorOpen}
        onOpenChange={onTextColorOpenChange}
        onApply={applyTextColor}
        allowNone={false}
        slotPrefix={colorSlotPrefix}
      />
      {/* The text style (the weight x the slant). */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            data-slot={`${slotPrefix}-text-style`}
            aria-label="Text style"
            title="Text style"
          >
            <Italic className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={TOOLTIP_SIDE_OFFSET_PX} aria-label="Text style">
          {SHAPE_TEXT_STYLE_OPTIONS.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.id}
              aria-label={option.label}
              data-style={option.id}
              checked={textStyle === option.id}
              onSelect={applyTextStyle(option.id)}
            >
              {option.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* The font size (the numeric field: any 8–512 stand, the
          list the hints). */}
      <div className="relative" data-slot={`${slotPrefix}-font-size-wrap`}>
        <Datalist id={sizeListId}>
          {SHAPE_FONT_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size} />
          ))}
        </Datalist>
        <Input
          size="sm"
          type="number"
          min={8}
          max={512}
          step="1"
          list={sizeListId}
          data-slot={`${slotPrefix}-font-size`}
          aria-label="Text font size"
          title="Text font size"
          placeholder={String(fontSize ?? 16)}
          value={sizeDraft}
          className="
            h-7 w-16 rounded-(--docblocks-radius) border-(--docblocks-formatbar-border-color)
            bg-(--docblocks-editor-background) px-2 text-center text-xs text-(--docblocks-text-color)
            dark:bg-(--docblocks-editor-background)
          "
          onMouseDown={stopPropagation}
          onChange={onSizeChange}
          onKeyDown={onSizeKeyDown}
          onBlur={commitSize}
        />
      </div>
      {/* The text alignment. */}
      {[
        { value: "left", icon: TextAlignStart, label: "Align left" },
        { value: "center", icon: TextAlignCenter, label: "Align center" },
        { value: "right", icon: TextAlignEnd, label: "Align right" },
      ].map(({ value, icon: AlignIcon, label }) => (
        <Button
          key={value}
          variant="ghost"
          size="icon"
          data-slot={`${slotPrefix}-align-${value}`}
          aria-label={label}
          title={label}
          aria-pressed={textAlign === value}
          className={cn("size-7", textAlign === value && ACTIVE_ITEM_CLASS)}
          onClick={applyAlign(value)}
        >
          <AlignIcon className="size-4" />
        </Button>
      ))}
    </>
  );
}

export { ShapeTextControls };
export type { ShapeTextControlsProps };
