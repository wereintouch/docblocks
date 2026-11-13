/** The slash menu's constants: the v1 command list + the empty-block
 *  placeholder. */
import {
  CodeXml,
  Database,
  File,
  Frame,
  Heading1,
  Heading2,
  Heading3,
  Link,
  List,
  ListOrdered,
  Pilcrow,
  Quote,
  SquareCheck,
  SquareSplitVertical,
  Table,
  TextQuote,
} from "../../shared/ui/icons";
import type { SlashCommand } from "./models";

/**
 * The empty-block hint text: shown while the caret sits in a text block
 * with no content, pointing at the "/" command palette (the
 * `commandPalettePlaceholder` provider prop overrides it).
 */
const COMMAND_PALETTE_PLACEHOLDER = "Type '/' for commands";

/** The v1 command list (filterable by the typed query). The `label` is the
 *  command's canonical en identity (the filter's primary text); the
 *  `labelKey` is the menu's display label over the current language. */
const SLASH_COMMANDS: SlashCommand[] = [
  { label: "Text", labelKey: "blocks.text", icon: Pilcrow, type: "paragraph" },
  { label: "Heading 1", labelKey: "blocks.heading1", icon: Heading1, type: "heading", attrs: { level: 1 } },
  { label: "Heading 2", labelKey: "blocks.heading2", icon: Heading2, type: "heading", attrs: { level: 2 } },
  { label: "Heading 3", labelKey: "blocks.heading3", icon: Heading3, type: "heading", attrs: { level: 3 } },
  { label: "Bulleted list", labelKey: "lists.bulleted", icon: List, type: "list-item", attrs: { list: "bullet" } },
  {
    label: "Numbered list",
    labelKey: "lists.numbered",
    icon: ListOrdered,
    type: "list-item",
    attrs: { list: "number" },
  },
  { label: "Task list", labelKey: "lists.task", icon: SquareCheck, type: "list-item", attrs: { list: "task" } },
  { label: "Quote", labelKey: "blocks.quote", icon: Quote, type: "quote" },
  { label: "Callout", labelKey: "blocks.callout", icon: TextQuote, type: "callout" },
  { label: "Code block", labelKey: "blocks.code", icon: CodeXml, type: "code" },
  {
    label: "Code block (mermaid)",
    labelKey: "blocks.codeMermaid",
    icon: CodeXml,
    type: "code",
    attrs: { language: "mermaid" },
  },
  { label: "Divider", labelKey: "blocks.divider", icon: SquareSplitVertical, type: "divider" },
  { label: "File", labelKey: "blocks.file", icon: File, type: "image" },
  { label: "Embed", labelKey: "blocks.embed", icon: Link, type: "embed" },
  { label: "Database", labelKey: "blocks.database", icon: Database, type: "database" },
  { label: "Frame", labelKey: "blocks.frame", icon: Frame, type: "frame" },
  { label: "Table", labelKey: "blocks.table", icon: Table, type: "table" },
];

export { COMMAND_PALETTE_PLACEHOLDER, SLASH_COMMANDS };
