import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, ReactNode, RefObject, SVGProps } from "react";

import type { Block, BlockId, TextAlign } from "docblocks-core";
import { CALLOUT_ICONS } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import { CALLOUT_ICON_COMPONENTS, CALLOUT_PRESET_ICONS, calloutIconName } from "../blocks";
import { useBlock, useSelection } from "../hooks";
import { Button } from "../shared/ui/Button";
import { ColorSwatches } from "../shared/ui/ColorSwatches";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../shared/ui/DropdownMenu";
import { Popover, PopoverContent, PopoverTrigger } from "../shared/ui/Popover";
import { Separator } from "../shared/ui/Separator";
import { cn } from "../shared/ui/cn";
import {
  Baseline,
  Bold,
  CodeXml,
  Dot,
  Italic,
  ListOrdered,
  Menu as MenuIcon,
  Pilcrow,
  Quote,
  SquareCheck,
  Strikethrough,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  Underline,
} from "../shared/ui/icons";
import { restoreSelectionIn } from "./block-commands";
import {
  TOOLBAR_BLOCK_TYPES,
  alignOfBlock,
  applyAlignRange,
  applyMarkRange,
  applyValueMarkRange,
  clearMarkRange,
  crossRangeEligible,
  crossRangeOf,
  rangeMarkAction,
  uniformAlignOfRange,
  uniformMarkValue,
  uniformMarkValueRange,
} from "./format-range";
import type { CrossRange } from "./format-range";
import { type FormatMark, markToggleAction } from "./keyboard";

/**
 * The floating format toolbar — the selection's formatting affordance.
 *
 * It is visible while the view's selection is a text range over a
 * toolbar-eligible target: a single block of an eligible type (paragraph,
 * quote, heading, list-item, callout, table-cell; code and
 * canvas-text have their
 * own formatting model) or a cross-block range whose chain text blocks are all
 * eligible. It floats above the selection (below it when there is no room
 * above) and disappears as soon as the selection collapses, leaves the
 * target, or becomes a blocks selection — the visibility is derived from
 * the selection state, so no key or mouse capture is needed.
 *
 * Controls (shared/ui primitives): the five toggle marks (bold, monospace =
 * the exclusive code mark, italic, underline, strikethrough) and the three
 * text alignments as ghost icon buttons; the alignment is a block attr
 * applied with updateBlock (set-only: updateBlock never removes attrs, so
 * "left" is how the default is restored). The list-type menu (single-block
 * paragraph/heading/list-item targets only) is a non-modal dropdown — a
 * radio group that turns the block into a bullet/numbered/to-do list (a
 * list-item swap is a `list` attr update; any other target is a
 * changeBlockType) or into a paragraph (the flat model: a list item's
 * derived segment re-attaches to the paragraph as its nested content —
 * nothing is lost). The highlight control is a non-modal popover with a target
 * switch (the text `color` mark vs the background `highlight` mark) and a
 * color palette (the shared palette's eight swatches, overridable through
 * the editor's `formatPalette` prop) plus a clear entry. The popovers are
 * portaled to
 * the document body (radix) and — like the bar — suppress the default
 * mousedown so the editor's text selection stays alive while a swatch or
 * option is picked; outside dismiss (pointer and focus) is suppressed the
 * same way the bar is not dismissed by its own buttons (the selection
 * state owns the visibility). A cross-block range applies the mark actions
 * over the range's per-block segments (the align per chain block) and hides
 * the list-type menu. A mark button is active when every run of the range
 * carries the mark; a swatch is active when the whole range is uniformly
 * marked with that value (a highlight without a value counts as the empty
 * value). Every action is doc command(s) inside one transaction (one undo
 * step, one wire update).
 */

/** A 24px-stroke icon component (the package icon set). */
type ToolbarIcon = ComponentType<SVGProps<SVGSVGElement>>;

/** The default format palette: the shared palette's seven pastel theme
 * tokens + the theme's own background token (a consumer can pass its own
 * through the editor's `formatPalette` prop — a `string[]` of hex or var). */
const FORMAT_PALETTE: readonly string[] = [
  "var(--docblocks-palette-red)",
  "var(--docblocks-palette-orange)",
  "var(--docblocks-palette-yellow)",
  "var(--docblocks-palette-green)",
  "var(--docblocks-palette-cyan)",
  "var(--docblocks-palette-blue)",
  "var(--docblocks-palette-violet)",
  "var(--background)",
];

/** The list-type menu options, in display order ("paragraph" = turn into text). */
const LIST_MENU_OPTIONS: {
  option: "bullet" | "number" | "task" | "quote" | "paragraph";
  label: string;
  icon: ToolbarIcon;
}[] = [
  { option: "bullet", label: "Bullet list", icon: Dot },
  { option: "number", label: "Numbered list", icon: ListOrdered },
  { option: "task", label: "To-do list", icon: SquareCheck },
  { option: "quote", label: "Quote", icon: Quote },
  { option: "paragraph", label: "Text", icon: Pilcrow },
];

/** The toggle mark buttons, in display order. */
const TOOLBAR_MARKS: { mark: FormatMark; title: string; icon: ToolbarIcon }[] = [
  { mark: "bold", title: "Bold", icon: Bold },
  { mark: "code", title: "Monospace", icon: CodeXml },
  { mark: "italic", title: "Italic", icon: Italic },
  { mark: "underline", title: "Underline", icon: Underline },
  { mark: "strike", title: "Strikethrough", icon: Strikethrough },
];

/** The alignment buttons, in display order. */
const TOOLBAR_ALIGNS: { align: TextAlign; title: string; icon: ToolbarIcon }[] = [
  { align: "left", title: "Align left", icon: TextAlignStart },
  { align: "center", title: "Align center", icon: TextAlignCenter },
  { align: "right", title: "Align right", icon: TextAlignEnd },
];

/** The palette target: which mark the picked color is applied to. */
type PaletteTarget = "color" | "highlight";

/** The toolbar's target range: a same-block range or a cross-block range over the engine's chain. */
type ToolbarRange =
  { kind: "single"; blockId: BlockId; from: number; to: number } | { kind: "cross"; cross: CrossRange };

/** Clamp a number into [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

interface FormatToolbarProps {
  rootRef: RefObject<HTMLElement | null>;
  palette: readonly string[];
}

function FormatToolbar({ rootRef, palette }: FormatToolbarProps) {
  const { doc } = useEditorContext();
  const selection = useSelection();
  const barRef = useRef<HTMLDivElement | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [listMenuOpen, setListMenuOpen] = useState(false);
  const [calloutMenuOpen, setCalloutMenuOpen] = useState(false);
  const [target, setTarget] = useState<PaletteTarget>("highlight");

  // The toolbar's target: a range inside a single block, or a cross-block
  // range whose chain text blocks are all toolbar-eligible.
  const range = useMemo<ToolbarRange | null>(() => {
    if (selection.kind !== "text" || selection.to === null) return null;
    if (selection.from.blockId === selection.to.blockId) {
      if (selection.from.offset === selection.to.offset) return null;
      return { kind: "single", blockId: selection.from.blockId, from: selection.from.offset, to: selection.to.offset };
    }
    const cross = crossRangeOf(selection);
    return cross !== null && crossRangeEligible(doc, cross) ? { kind: "cross", cross } : null;
  }, [doc, selection]);

  const block = useBlock(range !== null && range.kind === "single" ? range.blockId : "");

  // A moved selection is a fresh toolbar context: the palette closes. The
  // key (not the selection object) is the trigger — a mark applied through
  // the palette rebases the selection in place, which must not close it.
  const selectionKey =
    selection.kind === "text"
      ? `${selection.from.blockId}:${selection.from.offset}:${selection.to?.blockId ?? ""}:${selection.to?.offset ?? "caret"}`
      : selection.kind;
  useEffect(() => {
    setPaletteOpen(false);
    setListMenuOpen(false);
    setCalloutMenuOpen(false);
  }, [selectionKey]);

  // Anchor the bar above the selection rect (below it when there is no
  // room) and clamp it horizontally inside the editor root. The rect of a
  // cross-block DOM selection works the same way as a single-block one.
  useLayoutEffect(() => {
    const el = barRef.current;
    const root = rootRef.current;
    if (el === null || root === null) return;
    const domSelection = window.getSelection();
    if (domSelection === null || domSelection.rangeCount === 0) return;
    if (!root.contains(domSelection.anchorNode)) return;
    const range = domSelection.getRangeAt(0);
    // Environments without layout (jsdom) have no range geometry: the bar
    // stays at its default position there.
    if (typeof range.getBoundingClientRect !== "function") return;
    const rect = range.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const left = clamp(
      rect.left + rect.width / 2 - width / 2 - rootRect.left,
      8,
      Math.max(8, rootRect.width - width - 8)
    );
    const above = rect.top - rootRect.top - height - 8;
    const top = above < 4 ? rect.bottom - rootRect.top + 8 : above;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  });

  if (range === null) return null;
  if (range.kind === "single" && (block === undefined || !TOOLBAR_BLOCK_TYPES.has(block.type))) return null;
  // The single target is defined here (the guard above); a cross target
  // never reads it (its branches short-circuit first).
  const single = block as Block;
  const cross = range.kind === "cross";

  /** Toggle a mark over the target (one undo step, one wire update). */
  const onToggleMark = (mark: FormatMark): void => {
    if (range.kind === "cross") {
      if (rangeMarkAction(doc, range.cross, mark) === "unset") clearMarkRange(doc, range.cross, mark);
      else applyMarkRange(doc, range.cross, mark);
      return;
    }
    const action = markToggleAction(doc, range.blockId, range.from, range.to, mark);
    doc.transact(() => {
      if (action === "unset") doc.unsetMark(range.blockId, range.from, range.to, mark);
      else doc.setMark(range.blockId, range.from, range.to, { type: mark });
    });
  };

  /** Apply an alignment (set-only; the current one is a visible no-op). */
  const onAlign = (align: TextAlign): void => {
    if (range.kind === "cross") {
      if (uniformAlignOfRange(doc, range.cross) === align) return;
      applyAlignRange(doc, range.cross, align);
      return;
    }
    if (alignOfBlock(single) === align) return;
    doc.transact(() => {
      doc.updateBlock(range.blockId, { align });
    });
  };

  /** Apply the palette target's mark with the value (or clear it). */
  const onPaletteValue = (value: string | null): void => {
    if (range.kind === "cross") {
      const current = uniformMarkValueRange(doc, range.cross, target);
      if (current === value) return;
      if (value === null) clearMarkRange(doc, range.cross, target);
      else applyValueMarkRange(doc, range.cross, target, value);
      return;
    }
    const current = uniformMarkValue(single, range.from, range.to, target);
    if (current === value) return;
    doc.transact(() => {
      if (value === null) doc.unsetMark(range.blockId, range.from, range.to, target);
      else if (target === "color") doc.setMark(range.blockId, range.from, range.to, { type: "color", value });
      else doc.setMark(range.blockId, range.from, range.to, { type: "highlight", value });
    });
  };

  /**
   * The list-type menu action (single-block targets only): a swap inside a
   * list is a `list` attr update; any other target is a type change (the
   * target's required attrs come from the option). "Text" stands for a
   * list item with a derived segment (the flat model: the segment
   * re-attaches to the paragraph as its nested content — nothing is lost,
   * the indent stands).
   */
  const onListOption = (option: (typeof LIST_MENU_OPTIONS)[number]["option"]): void => {
    setListMenuOpen(false);
    if (range.kind !== "single") return;
    // A list-type swap or a type change remounts the block's subtree (the
    // wrapper tag swaps), so the DOM selection dies with it: the gesture's
    // range is re-seated on the rebuilt block (the content stands, so the
    // offsets remain valid).
    const seat: { from: number; to: number } = { from: range.from, to: range.to };
    // The gesture's own inner element: the motion view's exit clone keeps
    // this node connected while the remount adds the survivor, so the
    // re-seat must not mistake the clone for the target.
    const exclude =
      rootRef.current?.querySelector<HTMLElement>(
        `[data-block-id="${range.blockId}"][data-slot="docblocks/block-content"]`
      ) ?? null;
    if (option === "paragraph") {
      // A task's `checked` is dropped by the type change (the check state
      // is not carried into plain text).
      if (single.type !== "paragraph") doc.transact(() => doc.changeBlockType(range.blockId, "paragraph"));
      restoreSelectionIn(doc, range.blockId, seat.from, seat.to, rootRef.current ?? document, exclude);
      return;
    }
    if (option === "quote") {
      // A task's `checked` is a type-specific attr: the type change drops
      // it (the check state is not carried into a non-list type).
      if (single.type !== "quote") doc.transact(() => doc.changeBlockType(range.blockId, "quote"));
      restoreSelectionIn(doc, range.blockId, seat.from, seat.to, rootRef.current ?? document, exclude);
      return;
    }
    const currentList = single.type === "list-item" ? single.attrs.list : null;
    if (currentList === option) return;
    // A task converted away from the task kind loses its checked state
    // (back to the unchecked default — converting back yields a fresh
    // unchecked item). No mark is synthesized: the checked state renders
    // the block's composition at 30% opacity, never a strike.
    const isCheckedTask = single.type === "list-item" && single.attrs.list === "task" && single.attrs.checked === true;
    doc.transact(() => {
      if (single.type === "list-item") {
        if (isCheckedTask) {
          doc.updateBlock(range.blockId, { list: option, checked: false });
        } else {
          doc.updateBlock(range.blockId, { list: option });
        }
      } else {
        doc.changeBlockType(range.blockId, "list-item", { list: option });
      }
    });
    restoreSelectionIn(doc, range.blockId, seat.from, seat.to, rootRef.current ?? document, exclude);
  };

  // The callout's controls (single-block callout target only). The type
  // (preset) switch is one transact (the variant + the overrides reset to
  // null — the preset resets the individual overrides); the color / icon are
  // individual overrides (the variant stands — the preset identity is kept).
  // A no-op stand writes nothing (one action is one updateBlock: one undo
  // step, one wire update).
  const onCalloutPreset = (variant: "info" | "warning" | "danger"): void => {
    if (range.kind !== "single" || single.type !== "callout") return;
    const a = single.attrs ?? {};
    const noOverride = (a.color ?? null) === null && (a.icon ?? null) === null;
    if ((a.variant ?? "info") === variant && noOverride) return; // no-op
    doc.transact(() => doc.updateBlock(range.blockId, { variant, color: null, icon: null }));
  };
  const onCalloutColor = (color: string | null): void => {
    if (range.kind !== "single" || single.type !== "callout") return;
    if ((single.attrs?.color ?? null) === color) return; // no-op
    doc.updateBlock(range.blockId, { color });
  };
  const onCalloutIcon = (icon: string | null): void => {
    if (range.kind !== "single" || single.type !== "callout") return;
    if ((single.attrs?.icon ?? null) === icon) return; // no-op
    doc.updateBlock(range.blockId, { icon });
  };

  const markActive = (mark: FormatMark): boolean =>
    range.kind === "cross"
      ? rangeMarkAction(doc, range.cross, mark) === "unset"
      : markToggleAction(doc, range.blockId, range.from, range.to, mark) === "unset";

  const alignActive = (align: TextAlign): boolean =>
    range.kind === "cross" ? uniformAlignOfRange(doc, range.cross) === align : alignOfBlock(single) === align;

  const paletteActive = (value: string | null): boolean =>
    range.kind === "cross"
      ? uniformMarkValueRange(doc, range.cross, target) === value
      : uniformMarkValue(single, range.from, range.to, target) === value;

  // The palette's current uniform value (a hex, null when no mark stands,
  // or "mixed"): the selected swatch's seat. "mixed" matches no swatch.
  const currentMarkValue =
    range.kind === "cross"
      ? uniformMarkValueRange(doc, range.cross, target)
      : uniformMarkValue(single, range.from, range.to, target);

  // The list-type radio state (single-block eligible targets only — the
  // menu renders for paragraph, heading, and list-item blocks; the
  // cross-block target never renders it and has no `single` block).
  const listValue =
    block !== undefined && block.type === "list-item"
      ? block.attrs.list
      : block !== undefined && block.type === "paragraph"
        ? "paragraph"
        : block !== undefined && block.type === "quote"
          ? "quote"
          : "";

  return (
    <div
      data-slot="docblocks/format-toolbar"
      ref={barRef}
      role="toolbar"
      aria-label="Text formatting"
      className="
        absolute z-50 flex items-center gap-0.5 rounded-(--docblocks-radius) border
        border-(--docblocks-formatbar-border-color) bg-(--docblocks-formatbar-background) p-1 text-[0.8125em]
        text-(--docblocks-text-color) shadow-(--docblocks-formatbar-shadow)
      "
      // Keep the text selection: a default mousedown would move the caret
      // into the bar and dismiss the toolbar (the selection maps to none).
      onMouseDown={(event) => event.preventDefault()}
    >
      {TOOLBAR_MARKS.map(({ mark, title, icon: Icon }) => (
        <Button
          key={mark}
          variant="ghost"
          size="icon"
          data-mark={mark}
          title={title}
          aria-label={title}
          aria-pressed={markActive(mark)}
          className={cn(markActive(mark) && "bg-accent text-accent-foreground")}
          onClick={() => onToggleMark(mark)}
        >
          <Icon className="size-4" />
        </Button>
      ))}
      <Separator orientation="vertical" className="h-5" />
      {TOOLBAR_ALIGNS.map(({ align, title, icon: Icon }) => (
        <Button
          key={align}
          variant="ghost"
          size="icon"
          data-align-btn={align}
          title={title}
          aria-label={title}
          aria-pressed={alignActive(align)}
          className={cn(alignActive(align) && "bg-accent text-accent-foreground")}
          onClick={() => onAlign(align)}
        >
          <Icon className="size-4" />
        </Button>
      ))}
      {!cross &&
        (single.type === "paragraph" ||
          single.type === "quote" ||
          single.type === "heading" ||
          single.type === "list-item") && (
          <>
            <Separator orientation="vertical" className="h-5" />
            <DropdownMenu modal={false} open={listMenuOpen} onOpenChange={setListMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  title="List type"
                  aria-label="List type"
                  className="data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"
                >
                  <MenuIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              {/* The portaled content keeps the bar's mousedown guard: a
                default mousedown would blur the editable and kill the
                selection the gesture is about to re-seat. Outside dismiss
                (pointer and focus) is suppressed — the editor owns the
                focus, and the selection state owns the visibility. */}
              <DropdownMenuContent
                align="start"
                sideOffset={6}
                data-slot="docblocks/format-list-menu"
                onMouseDown={(event) => event.preventDefault()}
                onPointerDownOutside={(event) => event.preventDefault()}
                onFocusOutside={(event) => event.preventDefault()}
              >
                <DropdownMenuRadioGroup value={listValue}>
                  {LIST_MENU_OPTIONS.map(({ option, label, icon: Icon }) => {
                    const disabled = false;
                    return (
                      <DropdownMenuRadioItem
                        key={option}
                        value={option}
                        data-list-option={option}
                        disabled={disabled}
                        title={label}
                        onSelect={() => onListOption(option)}
                      >
                        <Icon className="size-4" />
                        {label}
                      </DropdownMenuRadioItem>
                    );
                  })}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      {!cross && single.type === "callout" && (
        <>
          <Separator orientation="vertical" className="h-5" />
          <Popover modal={false} open={calloutMenuOpen} onOpenChange={setCalloutMenuOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                title="Callout"
                aria-label="Callout"
                className="data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"
              >
                <MenuIcon className="size-4" />
              </Button>
            </PopoverTrigger>
            {/* The portaled content keeps the bar's mousedown guard: a default
              mousedown would blur the editable and kill the selection the
              gesture is about to re-seat. Outside dismiss (pointer and focus)
              is suppressed — the editor owns the focus, and the selection
              state owns the visibility. */}
            <PopoverContent
              align="start"
              sideOffset={6}
              data-slot="docblocks/format-callout-menu"
              className="w-auto p-2"
              onMouseDown={(event) => event.preventDefault()}
              onPointerDownOutside={(event) => event.preventDefault()}
              onFocusOutside={(event) => event.preventDefault()}
            >
              {/* Type (the preset: the variant + the overrides reset to the
                preset — one transact). */}
              <div role="group" aria-label="Callout type" className="flex gap-1">
                {(["info", "warning", "danger"] as const).map((variant) => {
                  const active = (single.attrs?.variant ?? "info") === variant;
                  const PresetIcon = CALLOUT_ICON_COMPONENTS[CALLOUT_PRESET_ICONS[variant]];
                  return (
                    <Button
                      key={variant}
                      variant="ghost"
                      size="sm"
                      data-callout-type-btn={variant}
                      aria-pressed={active}
                      aria-label={`${variant} callout`}
                      title={`${variant} callout`}
                      className={cn("h-7", active && "bg-accent text-accent-foreground")}
                      onClick={() => onCalloutPreset(variant)}
                    >
                      {PresetIcon !== undefined && <PresetIcon className="size-4" />}
                    </Button>
                  );
                })}
              </div>
              {/* Color (the override; the transparent swatch = the preset). */}
              <div className="mt-2 border-t border-border pt-2">
                <ColorSwatches
                  colors={palette}
                  current={single.attrs?.color ?? null}
                  onSelect={(hex) => onCalloutColor(hex)}
                  label="callout"
                  allowNone
                  noneActive={(single.attrs?.color ?? null) === null}
                  onSelectNone={() => onCalloutColor(null)}
                />
              </div>
              {/* Icon (the catalog grid; "Preset" = the variant's icon). */}
              <div className="mt-2 border-t border-border pt-2">
                <div role="group" aria-label="Callout icon" className="grid grid-cols-6 gap-1">
                  {CALLOUT_ICONS.map((name) => {
                    const Icon = CALLOUT_ICON_COMPONENTS[name];
                    const active = calloutIconName(single.attrs?.icon, single.attrs?.variant ?? "info") === name;
                    if (Icon === undefined) return null; // the drift test keeps this in step
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
                        onClick={() => onCalloutIcon(name)}
                      >
                        <Icon className="size-4" />
                      </Button>
                    );
                  })}
                  <Button
                    variant="ghost"
                    size="sm"
                    data-callout-icon-preset
                    aria-label="Preset icon"
                    title="Preset icon"
                    className={cn(
                      "col-span-6 h-7 text-xs",
                      (single.attrs?.icon ?? null) === null && "bg-accent text-accent-foreground"
                    )}
                    onClick={() => onCalloutIcon(null)}
                  >
                    Preset
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </>
      )}
      <Separator orientation="vertical" className="h-5" />
      <Popover modal={false} open={paletteOpen} onOpenChange={setPaletteOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            data-target={target}
            title="Text and background color"
            aria-label="Text and background color"
            className="data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"
          >
            <Baseline className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          data-slot="docblocks/format-palette"
          aria-label="Text and background color"
          className="w-auto p-2"
          onMouseDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          onFocusOutside={(event) => event.preventDefault()}
        >
          <div role="group" aria-label="Color target" className="flex gap-1">
            {(["highlight", "color"] as const).map((t) => (
              <Button
                key={t}
                variant="ghost"
                size="sm"
                data-target-btn={t}
                aria-pressed={target === t}
                aria-label={t === "highlight" ? "Highlight the background" : "Color the text"}
                title={t === "highlight" ? "Highlight the background" : "Color the text"}
                className={cn("h-7 flex-1 text-xs", target === t && "bg-accent text-accent-foreground")}
                onClick={() => setTarget(t)}
              >
                {t === "highlight" ? "bg" : "text"}
              </Button>
            ))}
          </div>
          <ColorSwatches
            colors={palette}
            current={currentMarkValue}
            onSelect={(hex) => onPaletteValue(hex)}
            label={target === "highlight" ? "highlight" : "text"}
            allowNone
            noneActive={paletteActive(null)}
            onSelectNone={() => onPaletteValue(null)}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** The editor-level format toolbar layer (null while no eligible range is selected). */
function useFormatToolbar(
  rootRef: RefObject<HTMLElement | null>,
  palette: readonly string[]
): {
  toolbarNode: ReactNode;
} {
  return { toolbarNode: <FormatToolbar rootRef={rootRef} palette={palette} /> };
}

export { FORMAT_PALETTE, useFormatToolbar };
