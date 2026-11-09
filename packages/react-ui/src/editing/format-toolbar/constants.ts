/** The format toolbar's display constants: the default format palette
 * (the shared palette's seven pastel theme tokens + the theme's own
 * background token — a consumer can pass its own through the editor's
 * `formatPalette` prop — a `string[]` of hex or var), the list-type menu
 * options (in display order — "paragraph" = turn into text), the toggle
 * mark buttons (in display order), the alignment buttons (in display
 * order). The `title` / `label` fields are i18n keys (the `editor`
 * namespace's `formatToolbar` group) — the toolbar resolves them over the
 * current language at render time. */
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
  { option: "bullet", label: "formatToolbar.lists.bullet", icon: Dot },
  { option: "number", label: "formatToolbar.lists.number", icon: ListOrdered },
  { option: "task", label: "formatToolbar.lists.task", icon: SquareCheck },
  { option: "quote", label: "formatToolbar.lists.quote", icon: Quote },
  { option: "paragraph", label: "formatToolbar.lists.paragraph", icon: Pilcrow },
];

/** The toggle mark buttons, in display order. */
const TOOLBAR_MARKS: { mark: FormatMark; title: string; icon: ToolbarIcon }[] = [
  { mark: "bold", title: "formatToolbar.marks.bold", icon: Bold },
  { mark: "code", title: "formatToolbar.marks.code", icon: CodeXml },
  { mark: "italic", title: "formatToolbar.marks.italic", icon: Italic },
  { mark: "underline", title: "formatToolbar.marks.underline", icon: Underline },
  { mark: "strike", title: "formatToolbar.marks.strike", icon: Strikethrough },
];

/** The alignment buttons, in display order. */
const TOOLBAR_ALIGNS: { align: TextAlign; title: string; icon: ToolbarIcon }[] = [
  { align: "left", title: "formatToolbar.align.left", icon: TextAlignStart },
  { align: "center", title: "formatToolbar.align.center", icon: TextAlignCenter },
  { align: "right", title: "formatToolbar.align.right", icon: TextAlignEnd },
];

/** The active item's stand (the pressed / the current's tint). */
const ACTIVE_ITEM_CLASS = "bg-accent text-accent-foreground";

/** The menu's offset from the trigger (px). */
const MENU_SIDE_OFFSET_PX = 6;

export { ACTIVE_ITEM_CLASS, FORMAT_PALETTE, LIST_MENU_OPTIONS, MENU_SIDE_OFFSET_PX, TOOLBAR_ALIGNS, TOOLBAR_MARKS };
