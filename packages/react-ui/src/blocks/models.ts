/** The text block's shared types: the editable block types (the wrapper
 * tag and data attrs are props over the renderer) and the wrapper tag's
 * union. */
import type { Block } from "docblocks-core";

/** The text-editable block types (the wrapper tag and data attrs are props). */
type EditableBlock = Extract<
  Block,
  { type: "paragraph" | "quote" | "heading" | "callout" | "list-item" | "code" | "canvas-text" }
>;

/** The wrapper tag (the `li` stands the list row, the `aside` the callout). */
type TextBlockTag = "div" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "aside" | "li" | "pre";

export type { EditableBlock, TextBlockTag };
