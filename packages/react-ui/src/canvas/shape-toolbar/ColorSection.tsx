/** One color section of the shape toolbar (the fill or the stroke). The
 * open state is the toolbar's (the sections are mutually exclusive — the
 * non-modal popover does not close on an outside click, so a per-section
 * state would let both palettes stand open at once). */
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";

import { useFormatPalette } from "../../blocks/format-palette-context";
import { Button, Input } from "../../shared/ui";
import { ColorSwatches } from "../../shared/ui/ColorSwatches";
import { Popover, PopoverContent, PopoverTrigger } from "../../shared/ui/Popover";
import { X } from "../../shared/ui/icons";
import { preventDefault, stopPropagation } from "../../shared/utils";
import { normalizeHex } from "./utils";

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
  const lower = current?.toLowerCase();

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

  const selectNone = () => apply("none");
  const onHexChange = (event: React.ChangeEvent<HTMLInputElement>) => setDraft(event.target.value);
  const onHexKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitDraft();
    }
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
        onMouseDown={preventDefault}
        onPointerDownOutside={preventDefault}
        onFocusOutside={preventDefault}
      >
        <ColorSwatches
          colors={palette}
          current={lower}
          onSelect={onApply}
          label={target}
          allowNone={allowNone}
          noneActive={none}
          onSelectNone={allowNone ? selectNone : undefined}
        />
        <Input
          size="sm"
          data-slot={`docblocks/shape-${target}-hex`}
          aria-label={`${label} hex value`}
          className="
            mt-2 h-7 w-full rounded-(--docblocks-radius) border-(--docblocks-formatbar-border-color)
            bg-(--docblocks-editor-background) px-2 font-mono text-xs text-(--docblocks-text-color)
            dark:bg-(--docblocks-editor-background)
          "
          placeholder="#rrggbb"
          value={draft}
          onChange={onHexChange}
          onMouseDown={stopPropagation}
          onKeyDown={onHexKeyDown}
          onBlur={commitDraft}
        />
      </PopoverContent>
    </Popover>
  );
}

export { ColorSection };
