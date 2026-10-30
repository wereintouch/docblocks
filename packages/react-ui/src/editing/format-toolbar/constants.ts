/** The format toolbar's display constants: the default format palette
 * (the shared palette's seven pastel theme tokens + the theme's own
 * background token — a consumer can pass its own through the editor's
 * `formatPalette` prop — a `string[]` of hex or var), the list-type menu
 * options (in display order — "paragraph" = turn into text), the toggle
 * mark buttons (in display order), the alignment buttons (in display
 * order). */
import type { TextAlign } from "docblocks-core";

import {
  Bold,
  CodeXml,
  Dot,
  Italic,
  ListOrdered,
  Pilcrow,
  Quote,
  SquareCheck,
  Strikethrough,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  Underline,
} from "../../shared/ui/icons";
import type { FormatMark } from "../keyboard";
import type { ToolbarIcon } from "./models";

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

/** The active item's stand (the pressed / the current's tint). */
const ACTIVE_ITEM_CLASS = "bg-accent text-accent-foreground";

/** The menu's offset from the trigger (px). */
const MENU_SIDE_OFFSET_PX = 6;

export { ACTIVE_ITEM_CLASS, FORMAT_PALETTE, LIST_MENU_OPTIONS, MENU_SIDE_OFFSET_PX, TOOLBAR_ALIGNS, TOOLBAR_MARKS };
