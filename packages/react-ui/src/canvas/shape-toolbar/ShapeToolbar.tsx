/**
 * The shape's floating toolbar (the single `shape` selection): the type
 * picker (the figure), the text controls (the add-text button for the
 * textless stand; the font / color / style / size / alignment for the
 * texted stand), the fill and the stroke sections (the palette
 * swatches, the "none" entry, the custom hex), and the z-order menu
 * (the explicit zIndex: the three-dots button, the four
 * reorder picks — one `setZOrder` each). Each apply is one `updateBlock`
 * in one transact (one undo step, one wire update). The
 * toolbar is canvas chrome (its own pointers; a press on it starts no
 * canvas session).
 */
import type { CSSProperties } from "react";
import { useState } from "react";

import type { BlockId } from "docblocks-core";

import { useCanvasTextEdit } from "../../blocks/canvas-text-edit-context";
import { useEditorContext } from "../../editor-provider";
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  FigureBorderSelector,
  Input,
} from "../../shared/ui";
import { Datalist } from "../../shared/ui/Datalist";
import { Separator } from "../../shared/ui/Separator";
import { cn } from "../../shared/ui/cn";
import {
  Fill,
  Italic,
  Minus,
  Palette,
  Stroke,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  Type,
  X,
} from "../../shared/ui/icons";
import { stopPropagation } from "../../shared/utils";
import { ZOrderMenu } from "../ZOrderMenu";
import { SHAPE_FONT_OPTIONS, SHAPE_FONT_SIZE_OPTIONS, SHAPE_TEXT_STYLE_OPTIONS } from "../text-fonts";
import { ColorSection } from "./ColorSection";
import { BORDER_WIDTH_POINTS, SHAPE_VARIANTS } from "./constants";
import type { ShapeVariantId } from "./models";
import { borderWidthIndex, variantIcon } from "./utils";

function ShapeToolbar({
  id,
  fill,
  stroke,
  strokeWidth,
  strokeStyle,
  variant,
  text,
  fontSize,
  fontFamily,
  textColor,
  textStyle,
  textAlign,
  zStand,
  style,
}: {
  id: BlockId;
  fill: string | undefined;
  stroke: string | undefined;
  /** The border's width in px (the 1–4 stand; the absent stand is 2). */
  strokeWidth: number | undefined;
  /** The border's style (solid / dash; the absent stand is the solid line). */
  strokeStyle: "solid" | "dash" | "dot" | undefined;
  variant: ShapeVariantId | undefined;
  text: string | undefined;
  fontSize: number | undefined;
  fontFamily: string | undefined;
  textColor: string | undefined;
  textStyle: string | undefined;
  textAlign: string | undefined;
  /** The z-order stand (the position / count over the surface's canvas
   *  elements); absent when the target's surface is unknown. */
  zStand: { position: number; count: number } | null;
  style: CSSProperties;
}) {
  const { doc } = useEditorContext();
  const textEdit = useCanvasTextEdit();
  const VariantIcon = variantIcon(variant);
  // The open section (the sections are mutually exclusive — the
  // non-modal popover does not close on an outside click, so a
  // per-section state would let both palettes stand open at once).
  const [openSection, setOpenSection] = useState<"fill" | "stroke" | "text" | null>(null);
  // The size field's draft (the typed stand; the attr stands the commit).
  const [sizeDraft, setSizeDraft] = useState("");
  const hasText = (text ?? "").length > 0;
  const borderNone = stroke === "none";
  const sizeListId = `docblocks-shape-size-${id}`;

  const applyAttr = (patch: Record<string, unknown>) => {
    doc.transact(() => {
      doc.updateBlock(id, patch);
    });
  };

  // The type switch (the shape's figure): one updateBlock in one
  // transact (one undo step, one wire update). A freehand shape keeps
  // its points (the stroke path wins over the variant — the v1 limit).
  const applyVariant = (next: ShapeVariantId) => {
    if (next === variant) return;
    applyAttr({ variant: next });
  };

  const commitSize = () => {
    const value = Number.parseInt(sizeDraft, 10);
    setSizeDraft("");
    if (Number.isNaN(value)) return; // the invalid draft is ignored (the input keeps its text)
    const clamped = Math.min(512, Math.max(8, value));
    if (clamped === fontSize) return;
    applyAttr({ fontSize: clamped });
  };

  // The press on the toolbar body (the trigger buttons) keeps the canvas
  // container's focus (the keyboard context). A press on the portaled
  // palette content (the fiber path crosses this wrapper, the target is
  // not contained in it) is NOT guarded: the hex input must receive the
  // mousedown default (the focus transfer).
  const onBodyMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Node && event.currentTarget.contains(event.target)) {
      event.preventDefault();
    }
  };
  const applyVariantAt = (variantId: ShapeVariantId) => () => applyVariant(variantId);
  const applyFontFamily = (fontFamilyId: string) => () => applyAttr({ fontFamily: fontFamilyId });
  const applyTextStyle = (textStyleId: string) => () => applyAttr({ textStyle: textStyleId });
  const openTextSection = (open: boolean) => setOpenSection(open ? "text" : null);
  const applyTextColor = (value: string | null) => applyAttr({ textColor: value });
  const onSizeChange = (event: React.ChangeEvent<HTMLInputElement>) => setSizeDraft(event.target.value);
  const onSizeKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitSize();
    }
  };
  const applyAlign = (value: string) => () => applyAttr({ textAlign: value });
  const beginTextEdit = () => textEdit?.setEditingId(id);
  const openFillSection = (open: boolean) => setOpenSection(open ? "fill" : null);
  const applyFill = (value: string | null) => applyAttr({ fill: value });
  const openStrokeSection = (open: boolean) => setOpenSection(open ? "stroke" : null);
  const applyStroke = (value: string | null) => applyAttr({ stroke: value });
  const applyStrokeWidth = (index: number) => applyAttr({ strokeWidth: BORDER_WIDTH_POINTS[index] });

  return (
    <div
      data-slot="docblocks/canvas-chrome"
      className="absolute z-50"
      style={{ ...style, transform: "translate(-50%, -100%)" }}
      onMouseDown={onBodyMouseDown}
    >
      <div
        data-slot="docblocks/shape-toolbar"
        role="toolbar"
        aria-label="Shape options"
        className="
          flex items-center gap-0.5 rounded-(--docblocks-radius) border border-(--docblocks-formatbar-border-color)
          bg-(--docblocks-formatbar-background) p-1 text-(--docblocks-text-color) shadow-(--docblocks-formatbar-shadow)
        "
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              data-slot="docblocks/shape-toolbar-variant"
              aria-label="Shape type"
              title="Shape type"
            >
              <VariantIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={8} aria-label="Shape types">
            {SHAPE_VARIANTS.map(({ id: variantId, label, icon: Icon }) => (
              <DropdownMenuCheckboxItem
                key={variantId}
                aria-label={label}
                data-variant={variantId}
                checked={variant === variantId}
                onSelect={applyVariantAt(variantId)}
              >
                <Icon />
                {label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Separator orientation="vertical" className="h-5" />
        {hasText ? (
          <>
            {/* The font family (the self-hosted set; an unrecognized name
                stands the raw name — the consumer's own font by name). */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  data-slot="docblocks/shape-toolbar-font-family"
                  aria-label="Text font family"
                  title="Text font family"
                >
                  <Type className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" sideOffset={8} aria-label="Text font family">
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
              open={openSection === "text"}
              onOpenChange={openTextSection}
              onApply={applyTextColor}
              allowNone={false}
            />
            {/* The text style (the weight x the slant). */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  data-slot="docblocks/shape-toolbar-text-style"
                  aria-label="Text style"
                  title="Text style"
                >
                  <Italic className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" sideOffset={8} aria-label="Text style">
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
            <div className="relative" data-slot="docblocks/shape-toolbar-font-size-wrap">
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
                data-slot="docblocks/shape-toolbar-font-size"
                aria-label="Text font size"
                title="Text font size"
                placeholder={String(fontSize ?? 16)}
                value={sizeDraft}
                className="
                  h-7 w-12 rounded-(--docblocks-radius) border-(--docblocks-formatbar-border-color)
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
                data-slot={`docblocks/shape-toolbar-align-${value}`}
                aria-label={label}
                title={label}
                aria-pressed={textAlign === value}
                className={cn("size-7", textAlign === value && "bg-accent text-accent-foreground")}
                onClick={applyAlign(value)}
              >
                <AlignIcon className="size-4" />
              </Button>
            ))}
          </>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            data-slot="docblocks/shape-toolbar-add-text"
            aria-label="Add text"
            title="Add text (or double-click the shape)"
            onClick={beginTextEdit}
          >
            <Type className="size-4" />
          </Button>
        )}
        <Separator orientation="vertical" className="h-5" />
        <ColorSection
          target="fill"
          label="Shape fill color"
          current={fill}
          chipStyle={{ background: fill ?? "transparent" }}
          icon={<Fill className="size-4" />}
          open={openSection === "fill"}
          onOpenChange={openFillSection}
          onApply={applyFill}
        />
        <ColorSection
          target="stroke"
          label="Shape stroke color"
          current={stroke}
          chipStyle={{ border: `2px solid ${stroke ?? "currentColor"}` }}
          icon={<Stroke className="size-4" />}
          open={openSection === "stroke"}
          onOpenChange={openStrokeSection}
          onApply={applyStroke}
        />
        {/* The border's width (the 1–4 px dots; the absent stand is the
            2 px default) + the style (the solid / the dashed / none). */}
        <FigureBorderSelector
          points={BORDER_WIDTH_POINTS.length}
          value={borderWidthIndex(strokeWidth)}
          onChange={applyStrokeWidth}
          label="Shape border width"
          title="Border width (1–4 px)"
          className="mr-0.5"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              data-slot="docblocks/shape-toolbar-border-style"
              aria-label="Shape border style"
              title="Border style"
            >
              {borderNone ? <X className="size-4" /> : <Minus className="size-4" />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={8} aria-label="Border styles">
            <DropdownMenuCheckboxItem
              checked={!borderNone && (strokeStyle ?? "solid") === "solid"}
              onCheckedChange={(checked) => {
                if (!checked) return;
                applyAttr({ strokeStyle: "solid" });
              }}
            >
              Solid line
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={!borderNone && strokeStyle === "dash"}
              onCheckedChange={(checked) => {
                if (!checked) return;
                applyAttr({ strokeStyle: "dash" });
              }}
            >
              Dashed
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={borderNone}
              onCheckedChange={(checked) => {
                if (!checked) return;
                applyAttr({ stroke: "none" });
              }}
            >
              No border
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Separator orientation="vertical" className="h-5" />
        {/* The z-order menu (the explicit zIndex): the three-dots button,
            three-dots button, the four reorder picks. */}
        {zStand !== null && (
          <ZOrderMenu targetId={id} position={zStand.position} count={zStand.count} label="Arrange shape" />
        )}
      </div>
    </div>
  );
}

export { ShapeToolbar };
