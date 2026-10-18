import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";

import type { BlockId } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import { useFormatPalette } from "../blocks/format-palette-context";
import { Button } from "../shared/ui";
import { Popover, PopoverContent, PopoverTrigger } from "../shared/ui/Popover";
import { cn } from "../shared/ui/cn";
import { Fill } from "../shared/ui/icons/Fill";
import { Stroke } from "../shared/ui/icons/Stroke";
import { X } from "../shared/ui/icons/X";

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
}: {
  target: "fill" | "stroke";
  label: string;
  current: string | undefined;
  /** The button's chip style (the current value's preview). */
  chipStyle: CSSProperties;
  icon: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (value: string) => void;
}) {
  const palette = useFormatPalette();
  const [draft, setDraft] = useState("");
  const none = current === undefined || current === "none";

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
  target: "fill" | "stroke",
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
 * The shape's floating color toolbar (the single `shape` selection): the
 * fill and the stroke sections (the palette swatches, the "none" entry,
 * the custom hex). Each apply is one `updateBlock` in one transact (one
 * undo step, one wire update). The toolbar is canvas chrome (its own
 * pointers; a press on it starts no canvas session).
 */
function ShapeToolbar({
  id,
  fill,
  stroke,
  style,
}: {
  id: BlockId;
  fill: string | undefined;
  stroke: string | undefined;
  style: CSSProperties;
}) {
  const { doc } = useEditorContext();
  // The open section (the sections are mutually exclusive — the
  // non-modal popover does not close on an outside click, so a
  // per-section state would let both palettes stand open at once).
  const [openSection, setOpenSection] = useState<"fill" | "stroke" | null>(null);

  const apply = (target: "fill" | "stroke", value: string) => {
    doc.transact(() => {
      if (target === "fill") doc.updateBlock(id, { fill: value });
      else doc.updateBlock(id, { stroke: value });
    });
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
        aria-label="Shape colors"
        className="
          flex items-center gap-0.5 rounded-(--docblocks-radius) border border-(--docblocks-formatbar-border-color)
          bg-(--docblocks-formatbar-background) p-1 text-(--docblocks-text-color) shadow-(--docblocks-formatbar-shadow)
        "
      >
        <ColorSection
          target="fill"
          label="Shape fill color"
          current={fill}
          chipStyle={{ background: fill ?? "transparent" }}
          icon={<Fill className="size-4" />}
          open={openSection === "fill"}
          onOpenChange={(value) => setOpenSection(value ? "fill" : null)}
          onApply={(value) => apply("fill", value)}
        />
        <ColorSection
          target="stroke"
          label="Shape stroke color"
          current={stroke}
          chipStyle={{ border: `2px solid ${stroke ?? "currentColor"}` }}
          icon={<Stroke className="size-4" />}
          open={openSection === "stroke"}
          onOpenChange={(value) => setOpenSection(value ? "stroke" : null)}
          onApply={(value) => apply("stroke", value)}
        />
      </div>
    </div>
  );
}

export { ShapeToolbar };
