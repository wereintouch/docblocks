import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";

import type { BlockId } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import { useCanvasTextEdit } from "../blocks/canvas-text-edit-context";
import { useFormatPalette } from "../blocks/format-palette-context";
import { Button, DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "../shared/ui";
import { Popover, PopoverContent, PopoverTrigger } from "../shared/ui/Popover";
import { Separator } from "../shared/ui/Separator";
import { cn } from "../shared/ui/cn";
import {
  Circle,
  Diamond,
  Fill,
  Italic,
  Palette,
  Square,
  SquareRounded,
  Stroke,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  Type,
  X,
} from "../shared/ui/icons";
import { SHAPE_FONT_OPTIONS, SHAPE_FONT_SIZE_OPTIONS, SHAPE_TEXT_STYLE_OPTIONS } from "./text-fonts";

/** The shape types (the dock's shapes menu and the toolbar's type picker). */
const SHAPE_VARIANTS = [
  { id: "rect", label: "Rectangle", icon: Square },
  { id: "rounded", label: "Rounded Rectangle", icon: SquareRounded },
  { id: "ellipse", label: "Ellipse", icon: Circle },
  { id: "diamond", label: "Diamond", icon: Diamond },
] as const;

type ShapeVariantId = (typeof SHAPE_VARIANTS)[number]["id"];

/** The current variant's icon (the type picker's trigger face). */
function variantIcon(variant: ShapeVariantId | undefined) {
  switch (variant) {
    case "ellipse":
      return Circle;
    case "diamond":
      return Diamond;
    case "rounded":
      return SquareRounded;
    default:
      return Square;
  }
}

/** The hex input's accepted form (3 or 6 digits, the `#` optional). */
const HEX_RE = /^(?:#)?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Normalizes the hex input to `#rrggbb`-form digits; null when invalid. */
function normalizeHex(raw: string): string | null {
  const match = raw.trim().match(HEX_RE);
  const digits = match?.[1];
  return digits === undefined ? null : `#${digits.toLowerCase()}`;
}

/** One color section of the shape toolbar (the fill or the stroke). The
 * open state is the toolbar's (the sections are mutually exclusive — the
 * non-modal popover does not close on an outside click, so a per-section
 * state would let both palettes stand open at once). */
function ColorSection({
  target,
  label,
  current,
  chipStyle,
  icon,
  open,
  onOpenChange,
  onApply,
  allowNone = true,
}: {
  target: "fill" | "stroke" | "text";
  label: string;
  current: string | undefined;
  /** The button's chip style (the current value's preview). */
  chipStyle: CSSProperties;
  icon: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (value: string) => void;
  /** The "no color" entry (absent for the text color — the unset stand is
   * the inheritance, and the hex spec rejects the "none" value). */
  allowNone?: boolean;
}) {
  const palette = useFormatPalette();
  const [draft, setDraft] = useState("");
  const none = allowNone && (current === undefined || current === "none");

  // The draft is the open popover's state — a closed section starts
  // fresh (a stale valid draft would re-apply on the next Enter). The
  // effect (not the popover's onOpenChange) also covers the programmatic
  // closes (the apply paths close the section directly).
  useEffect(() => {
    if (!open) setDraft("");
  }, [open]);

  const apply = (value: string | null) => {
    if (value === null) return;
    onApply(value);
    onOpenChange(false);
  };

  const commitDraft = () => {
    const normalized = normalizeHex(draft);
    if (normalized !== null) {
      onApply(normalized);
      onOpenChange(false);
    }
    // The invalid draft is ignored (the input keeps its text).
  };

  return (
    <Popover modal={false} open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          data-slot={`docblocks/shape-toolbar-${target}`}
          aria-label={label}
          title={label}
          className="data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"
        >
          <span className="flex items-center gap-1">
            {icon}
            {none ? (
              <X className="size-3 text-(--docblocks-muted-foreground)" />
            ) : (
              <span
                className="size-3 rounded-(--docblocks-radius)"
                style={{ ...chipStyle, border: "1px solid var(--docblocks-formatbar-border-color, #888)" }}
                aria-hidden
              />
            )}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        sideOffset={8}
        data-slot={`docblocks/shape-${target}-palette`}
        aria-label={label}
        className="w-auto p-2"
        // The palette suppresses the mousedown default (the house pattern,
        // the page format palette): the portaled content div is focusable
        // (the radix tabIndex -1) — a padding press would focus it, and a
        // key on that focus (not a form control) would reach the editor
        // root's blocks-selection handling. The hex input opts out via
        // stopPropagation (its focus transfer must stand).
        onMouseDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onFocusOutside={(event) => event.preventDefault()}
      >
        <div role="group" aria-label={`${label} colors`} className="grid grid-cols-3 gap-1">
          {paletteSwatches(target, current, palette, onApply)}
          {allowNone && (
            <Button
              variant="outline"
              size="icon"
              data-slot={`docblocks/shape-${target}-none`}
              title="No color"
              aria-label="No color"
              aria-pressed={none}
              className={cn("size-6", none && "ring-2 ring-ring")}
              onClick={() => apply("none")}
            >
              <X className="size-3.5" />
            </Button>
          )}
        </div>
        <input
          data-slot={`docblocks/shape-${target}-hex`}
          aria-label={`${label} hex value`}
          className="
            mt-2 h-7 w-full rounded-(--docblocks-radius) border border-(--docblocks-formatbar-border-color)
            bg-(--docblocks-editor-background) px-2 font-mono text-xs text-(--docblocks-text-color)
            focus:outline-none
          "
          placeholder="#rrggbb"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onMouseDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitDraft();
            }
          }}
          onBlur={commitDraft}
        />
      </PopoverContent>
    </Popover>
  );
}

function paletteSwatches(
  target: "fill" | "stroke" | "text",
  current: string | undefined,
  palette: readonly string[],
  onApply: (value: string) => void
) {
  const lower = current?.toLowerCase();
  return palette.map((color) => (
    <Button
      key={color}
      variant="outline"
      size="icon"
      data-slot={`docblocks/shape-${target}-swatch`}
      data-color={color}
      title={color}
      aria-label={`${target} color ${color}`}
      aria-pressed={lower === color}
      className={cn("size-6", lower === color && "ring-2 ring-ring")}
      style={{ background: color }}
      onClick={() => onApply(color)}
    />
  ));
}

/**
 * The shape's floating toolbar (the single `shape` selection): the type
 * picker (the figure), the text controls (the add-text button for the
 * textless stand; the font / color / style / size / alignment for the
 * texted stand), and the fill and the stroke sections (the palette
 * swatches, the "none" entry, the custom hex). Each apply is one
 * `updateBlock` in one transact (one undo step, one wire update). The
 * toolbar is canvas chrome (its own pointers; a press on it starts no
 * canvas session).
 */
function ShapeToolbar({
  id,
  fill,
  stroke,
  variant,
  text,
  fontSize,
  fontFamily,
  textColor,
  textStyle,
  textAlign,
  style,
}: {
  id: BlockId;
  fill: string | undefined;
  stroke: string | undefined;
  variant: ShapeVariantId | undefined;
  text: string | undefined;
  fontSize: number | undefined;
  fontFamily: string | undefined;
  textColor: string | undefined;
  textStyle: string | undefined;
  textAlign: string | undefined;
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

  return (
    <div
      data-slot="docblocks/canvas-chrome"
      className="absolute z-50"
      style={{ ...style, transform: "translate(-50%, -100%)" }}
      onMouseDown={(event) => {
        // The press on the toolbar body (the trigger buttons) keeps the
        // canvas container's focus (the keyboard context). A press on the
        // portaled palette content (the fiber path crosses this wrapper,
        // the target is not contained in it) is NOT guarded: the hex
        // input must receive the mousedown default (the focus transfer).
        if (event.target instanceof Node && event.currentTarget.contains(event.target)) {
          event.preventDefault();
        }
      }}
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
                onSelect={() => applyVariant(variantId)}
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
                    onSelect={() => applyAttr({ fontFamily: option.id })}
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
              onOpenChange={(value) => setOpenSection(value ? "text" : null)}
              onApply={(value) => applyAttr({ textColor: value })}
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
                    onSelect={() => applyAttr({ textStyle: option.id })}
                  >
                    {option.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {/* The font size (the numeric field: any 8–512 stand, the
                list the hints). */}
            <div className="relative" data-slot="docblocks/shape-toolbar-font-size-wrap">
              <datalist id={sizeListId}>
                {SHAPE_FONT_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size} />
                ))}
              </datalist>
              <input
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
                  h-7 w-12 rounded-(--docblocks-radius) border border-(--docblocks-formatbar-border-color)
                  bg-(--docblocks-editor-background) px-2 text-center text-xs text-(--docblocks-text-color)
                  focus:outline-none
                "
                onMouseDown={(event) => event.stopPropagation()}
                onChange={(event) => setSizeDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitSize();
                  }
                }}
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
                onClick={() => applyAttr({ textAlign: value })}
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
            onClick={() => textEdit?.setEditingId(id)}
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
          onOpenChange={(value) => setOpenSection(value ? "fill" : null)}
          onApply={(value) => applyAttr({ fill: value })}
        />
        <ColorSection
          target="stroke"
          label="Shape stroke color"
          current={stroke}
          chipStyle={{ border: `2px solid ${stroke ?? "currentColor"}` }}
          icon={<Stroke className="size-4" />}
          open={openSection === "stroke"}
          onOpenChange={(value) => setOpenSection(value ? "stroke" : null)}
          onApply={(value) => applyAttr({ stroke: value })}
        />
      </div>
    </div>
  );
}

export { ShapeToolbar };
