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

import { useEditorContext } from "../../editor-provider";
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  FigureBorderSelector,
} from "../../shared/ui";
import { Separator } from "../../shared/ui/Separator";
import { Fill, Minus, Stroke, Type, X } from "../../shared/ui/icons";
import { ZOrderMenu } from "../ZOrderMenu";
import { useCanvasTextEdit } from "../canvas-text-edit-context";
import { TOOLTIP_SIDE_OFFSET_PX } from "../viewport/constants";
import { ColorSection } from "./ColorSection";
import { ShapeTextControls } from "./ShapeTextControls";
import { BORDER_WIDTH_POINTS, SHAPE_VARIANTS } from "./constants";
import type { ShapeVariantId } from "./models";
import { borderWidthIndex, onToolbarBodyMouseDown, variantIcon } from "./utils";

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
  const hasText = (text ?? "").length > 0;
  const borderNone = stroke === "none";
  // The border-style's picks (the uncheck stands the no-op — the check's
  // press commits the attr).
  const pickBorderStyle = (style: "solid" | "dash") => (checked: boolean | "indeterminate") => {
    if (checked !== true) return;
    applyAttr({ strokeStyle: style });
  };
  const pickBorderNone = (checked: boolean | "indeterminate") => {
    if (checked !== true) return;
    applyAttr({ stroke: "none" });
  };

  const applyAttr = (patch: Record<string, unknown>) => {
    // The target's concurrent deletion (the peer removed the shape): the
    // block is gone — the gesture stands a no-op (the command over the
    // detached block would throw the typed error into the event handler).
    if (doc.getBlock(id) === null) return;
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

  const applyVariantAt = (variantId: ShapeVariantId) => () => applyVariant(variantId);
  const openTextSection = (open: boolean) => setOpenSection(open ? "text" : null);
  const openFillSection = (open: boolean) => setOpenSection(open ? "fill" : null);
  const applyFill = (value: string | null) => applyAttr({ fill: value });
  const openStrokeSection = (open: boolean) => setOpenSection(open ? "stroke" : null);
  const applyStroke = (value: string | null) => applyAttr({ stroke: value });
  const applyStrokeWidth = (index: number) => applyAttr({ strokeWidth: BORDER_WIDTH_POINTS[index] });
  const beginTextEdit = () => textEdit?.setEditingId(id);

  return (
    <div
      data-slot="docblocks/canvas-chrome"
      className="absolute z-50"
      style={{ ...style, transform: "translate(-50%, -100%)" }}
      onMouseDown={onToolbarBodyMouseDown}
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
          <DropdownMenuContent align="start" sideOffset={TOOLTIP_SIDE_OFFSET_PX} aria-label="Shape types">
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
          // The text controls (the shape's slot namespace — the shared
          // stand over the canvas-text's toolbar).
          <ShapeTextControls
            slotPrefix="docblocks/shape-toolbar"
            sizeListId={`docblocks-shape-size-${id}`}
            fontFamily={fontFamily}
            textColor={textColor}
            textStyle={textStyle}
            fontSize={fontSize}
            textAlign={textAlign}
            textColorOpen={openSection === "text"}
            onTextColorOpenChange={openTextSection}
            onApply={applyAttr}
          />
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
          <DropdownMenuContent align="end" sideOffset={TOOLTIP_SIDE_OFFSET_PX} aria-label="Border styles">
            <DropdownMenuCheckboxItem
              checked={!borderNone && (strokeStyle ?? "solid") === "solid"}
              onCheckedChange={pickBorderStyle("solid")}
            >
              Solid line
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={!borderNone && strokeStyle === "dash"}
              onCheckedChange={pickBorderStyle("dash")}
            >
              Dashed
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={borderNone} onCheckedChange={pickBorderNone}>
              No border
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Separator orientation="vertical" className="h-5" />
        {/* The z-order menu (the explicit zIndex): the three-dots button,
            the four reorder picks. */}
        {zStand !== null && (
          <ZOrderMenu targetId={id} position={zStand.position} count={zStand.count} label="Arrange shape" />
        )}
      </div>
    </div>
  );
}

export { ShapeToolbar };
