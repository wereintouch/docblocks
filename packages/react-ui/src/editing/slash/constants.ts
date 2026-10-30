/** The slash menu's constants: the v1 command list + the empty-block
 *  placeholder. */
import {
  CodeXml,
  Database,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
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

/** The v1 command list (filterable by the typed query). */
const SLASH_COMMANDS: SlashCommand[] = [
  { label: "Text", icon: Pilcrow, type: "paragraph" },
  { label: "Heading 1", icon: Heading1, type: "heading", attrs: { level: 1 } },
  { label: "Heading 2", icon: Heading2, type: "heading", attrs: { level: 2 } },
  { label: "Heading 3", icon: Heading3, type: "heading", attrs: { level: 3 } },
  { label: "Bulleted list", icon: List, type: "list-item", attrs: { list: "bullet" } },
  { label: "Numbered list", icon: ListOrdered, type: "list-item", attrs: { list: "number" } },
  { label: "Task list", icon: SquareCheck, type: "list-item", attrs: { list: "task" } },
  { label: "Quote", icon: Quote, type: "quote" },
  { label: "Callout", icon: TextQuote, type: "callout" },
  { label: "Code block", icon: CodeXml, type: "code" },
  { label: "Code block (mermaid)", icon: CodeXml, type: "code", attrs: { language: "mermaid" } },
  { label: "Divider", icon: SquareSplitVertical, type: "divider" },
  { label: "Image", icon: ImageIcon, type: "image" },
  { label: "Embed", icon: Link, type: "embed" },
  { label: "Database", icon: Database, type: "database" },
  { label: "Table", icon: Table, type: "table" },
];

export { COMMAND_PALETTE_PLACEHOLDER, SLASH_COMMANDS };
