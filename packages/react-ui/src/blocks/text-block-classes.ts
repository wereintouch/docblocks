/** The text block's class + data-attr math (pure): the wrapper's classes
 * (the gutter positioning box, the selected background, the heading
 * tokens, the callout / code / quote stands), the inner editable's
 * classes (the pre-wrap, the done-task fade, the highlight ink, the
 * alignment), and the gutter / plus / checkbox / collapse positions (the
 * first-line centering, the flat list's marker-zone shift). */
import type { CSSProperties } from "react";

import { cn } from "../shared/ui/cn";
import type { EditableBlock } from "./models";

/** The code body's collapsed clamp: the first 5 line boxes + the fade over the last 3 (the token-based calc). */
const COLLAPSED_CLAMP: CSSProperties = {
  maxHeight: "calc(5 * var(--docblocks-line-box-height))",
  overflow: "hidden",
  maskImage: "linear-gradient(to bottom, #000 calc(100% - 3 * var(--docblocks-line-box-height)), transparent 100%)",
  WebkitMaskImage:
    "linear-gradient(to bottom, #000 calc(100% - 3 * var(--docblocks-line-box-height)), transparent 100%)",
};

/**
 * The horizontal text alignment for the data attribute (absent = left, the
 * default). Code and canvas-text carry their own alignment model (none and
 * the `textAlign` attr), so they never expose `data-align`.
 */
function alignOf(block: EditableBlock): "left" | "center" | "right" | undefined {
  if (block.type === "code" || block.type === "canvas-text") return undefined;
  return "attrs" in block ? block.attrs?.align : undefined;
}

interface TextBlockClassArgs {
  block: EditableBlock;
  tag: TextBlockTag;
  selected: boolean;
  /** The canvas item's surface context (the page's row chrome stands off). */
  onSurface: boolean;
  /** The flat list row's marker-zone shift (absent = no shift). */
  flatListShift?: string;
  /** The collapse toggle's state (the reveal stand while expanded). */
  collapsed: boolean;
  /** The done task's fade (the content's 30% opacity). */
  doneTask: boolean;
  /** The highlight layer's gate (the inner's transparent ink). */
  highlightableCode: boolean;
  /** The wrap-OFF code (the single-line rows). */
  codeWrap: boolean;
  /** The callout's color override (the inline style's border + tint). */
  calloutColorOverride?: string;
  /** The callout's variant (the preset tokens' stand). */
  calloutVariant?: string;
}

type TextBlockTag = "div" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "aside" | "li" | "pre";

/**
 * The wrapper classes: the gutter positioning box (no focus outline).
 * Non-list blocks carry the vertical spacing (a list item's spacing
 * stands on its list); the selected background follows the blocks
 * selection; the heading weight and the h1-h3 sizes follow the heading
 * tokens.
 */
function wrapperClassOf({
  block,
  tag,
  selected,
  onSurface,
  calloutColorOverride,
  calloutVariant,
}: TextBlockClassArgs): string {
  const headingSize =
    block.type === "heading" && tag === "h1"
      ? "text-(length:--docblocks-heading-h1-font-size)"
      : block.type === "heading" && tag === "h2"
        ? "text-(length:--docblocks-heading-h2-font-size)"
        : block.type === "heading" && tag === "h3"
          ? "text-(length:--docblocks-heading-h3-font-size)"
          : undefined;
  return cn(
    "relative outline-none",
    // The canvas-text stands the box's vertical centering (the selection's
    // frame is the box — the text stands centered over it, the shape-text's
    // parity): the wrapper fills the item's box and centers the inner
    // vertically (the flex column's stretch keeps the inner's full width —
    // the wrap's stand).
    block.type === "canvas-text" && "flex h-full w-full flex-col justify-center",
    tag !== "li" && !onSurface && "my-(--docblocks-block-spacing)",
    // The selection's background (the page's selected-row tint): the
    // canvas's selection stand is the canvas-item's outline + background
    // only — the wrapper's tint stands a second patch over the content.
    selected && !onSurface && "bg-(--docblocks-selected-background)",
    block.type === "heading" && "font-(--docblocks-heading-font-weight)",
    headingSize,
    block.type === "callout" &&
      cn(
        // The structural stand (the border width, the radius, the padding —
        // the left stands the icon gutter). The color is the override (the
        // inline style) or the preset variant tokens (absent the override).
        "rounded-(--docblocks-radius) border-l-(length:--docblocks-callout-border-width)",
        "py-(--docblocks-callout-padding-y) pr-(--docblocks-callout-padding-x) pl-(--docblocks-callout-icon-gutter)",
        calloutColorOverride === undefined &&
          cn(
            "border-l-(--docblocks-callout-border-color-info) bg-(--docblocks-callout-background-info)",
            calloutVariant === "warning" &&
              "border-l-(--docblocks-callout-border-color-warning) bg-(--docblocks-callout-background-warning)",
            calloutVariant === "danger" &&
              "border-l-(--docblocks-callout-border-color-danger) bg-(--docblocks-callout-background-danger)"
          )
      ),
    block.type === "code" &&
      "rounded-(--docblocks-radius) bg-(--docblocks-code-background) p-(--docblocks-code-padding)",
    // The quote's marker zone: the left rule stands in the 20px zone left
    // of the text (the list rows' checkbox / number axis) — the wrapper's
    // own padding (every view, the rows add no zone padding for it).
    block.type === "quote" && "pl-(--docblocks-marker-width)"
  );
}

/**
 * The inner editable classes: no spacing of its own, the pre-wrap of the
 * line breaks, the zero-width line box of an empty editable (the caret
 * target — the pseudo-element content is not text content), and the
 * block's alignment (left is the default).
 */
function innerClassOf({
  block,
  doneTask,
  highlightableCode,
  codeWrap,
}: Pick<TextBlockClassArgs, "block" | "doneTask" | "highlightableCode" | "codeWrap">): string {
  const align = alignOf(block);
  return cn(
    "m-0 whitespace-pre-wrap outline-none",
    doneTask && "opacity-30",
    block.type === "code" && "font-(family-name:--docblocks-mono-font-family)",
    // The highlight layer stands the visible ink: the inner's text goes
    // transparent (the caret keeps the text color, the selection stands —
    // both are CSS properties, not text color).
    highlightableCode && "relative z-10 text-transparent caret-(--docblocks-text-color)",
    align === "center" && "text-center",
    align === "right" && "text-right",
    // The wrap-OFF code: single-line rows + the horizontal scrollbar (the
    // code-scroll container below scrolls; the wrap-ON default wraps).
    block.type === "code" && !codeWrap && "whitespace-pre"
  );
}

/**
 * The gutter handle classes: the grip control in the left margin (the
 * position reads the gutter tokens), revealed on a wrapper hover or while
 * the block is selected. Centered on the FIRST line (not the block's
 * vertical middle): a multi-line block keeps the grip at the line level.
 */
function gutterClassOf(selected: boolean): string {
  return cn(
    "absolute top-[calc((var(--docblocks-line-box-height)-var(--docblocks-gutter-size))/2)]",
    "cursor-pointer rounded-full opacity-0 group-hover:opacity-100",
    "left-(--docblocks-gutter-left) text-(--docblocks-gutter-color)",
    selected && "opacity-100"
  );
}

/**
 * The quick-insert plus classes: the reveal and the axis stand with the
 * grip (centered on the first line), the position is the band's plus
 * slot (the derived left, one slot right of the grip).
 */
function gutterPlusClassOf(selected: boolean): string {
  return cn(
    "absolute top-[calc((var(--docblocks-line-box-height)-var(--docblocks-gutter-plus-size))/2)]",
    "cursor-pointer rounded-full opacity-0 group-hover:opacity-100",
    "left-[calc(var(--docblocks-gutter-left)+var(--docblocks-gutter-size)+var(--docblocks-gutter-gap))]",
    "text-(--docblocks-gutter-color)",
    selected && "opacity-100"
  );
}

/** The gutter's shift over the flat list row's marker zone. */
function gutterShiftOf(flatListShift: string | undefined): CSSProperties | undefined {
  return flatListShift === undefined ? undefined : { left: `calc(var(--docblocks-gutter-left) - ${flatListShift})` };
}

/** The quick-insert plus's shift: one slot right of the grip in the gutter
 * band (the grip's size + the band's gap); the flat list's shift stands
 * with the grip. */
function gutterPlusShiftOf(flatListShift: string | undefined): CSSProperties | undefined {
  return flatListShift === undefined
    ? undefined
    : {
        left: `calc(var(--docblocks-gutter-left) + var(--docblocks-gutter-size) + var(--docblocks-gutter-gap) - ${flatListShift})`,
      };
}

/**
 * The task checkbox position (the list marker gutter; the Checkbox
 * primitive sizes itself). Centered on the first line like the gutter
 * band: the checkbox's box stands in the first line box, on the same
 * axis as the row text.
 */
const CHECKBOX_CLASS =
  "absolute left-(--docblocks-checkbox-left) top-[calc((var(--docblocks-line-box-height)-var(--docblocks-checkbox-size))/2)]";

/**
 * The collapse toggle: between the drag grip and the block content, in
 * the gutter band (every view), centered on the first line on the same
 * axis as the grip (a multi-line block keeps both at the line level). The
 * triangle is filled in both states — pointing right while collapsed,
 * down while expanded — in the block's text color (the gutter's muted
 * stands for the grip only). The hover highlight is the muted square
 * (rounded-xs) behind the triangle. The collapsed state is always
 * visible; the expanded state reveals on a wrapper hover, like the grip.
 * The ghost variant's hover colors are pinned back to the same values.
 * `text-[length:inherit]` keeps the em basis on the block's font (the
 * Button base carries text-sm).
 */
function collapseClassOf(collapsed: boolean): string {
  return cn(
    "absolute top-[calc((var(--docblocks-line-box-height)-var(--docblocks-collapse-size))/2)]",
    "size-5 cursor-pointer rounded-xs text-[length:inherit]",
    "left-(--docblocks-collapse-band-left)",
    "text-(--docblocks-text-color) hover:text-(--docblocks-text-color) dark:hover:text-(--docblocks-text-color)",
    "hover:bg-muted dark:hover:bg-muted",
    !collapsed && "opacity-0 group-hover:opacity-100"
  );
}

export {
  COLLAPSED_CLAMP,
  CHECKBOX_CLASS,
  alignOf,
  collapseClassOf,
  gutterClassOf,
  gutterPlusClassOf,
  gutterPlusShiftOf,
  gutterShiftOf,
  innerClassOf,
  wrapperClassOf,
};
export type { TextBlockClassArgs, TextBlockTag };
