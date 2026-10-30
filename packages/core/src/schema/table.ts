/** The table block types: the table attrs + the table / row / cell block
 *  shapes. */
import type { BlockContent } from "./text";
import type { BlockId, PageIndent, TableCellAttrs } from "./types";

interface TableAttrs {
  /** The per-column widths in px (mirrors `columnOrder`); absent — the default width per column. */
  columnWidths?: number[];
  /** Nesting depth in the page sequence (default 0). */
  indent?: PageIndent;
}

interface TableBlock {
  type: "table";
  /** The column identities + order (the single source of the column set); the column count is `columnOrder.length`. */
  columnOrder: string[];
  attrs?: TableAttrs;
  /** `table-row` blocks only. */
  children?: BlockId[];
}

interface TableRowBlock {
  type: "table-row";
  /** `table-cell` blocks only; exactly the table `columnOrder.length` count. */
  children?: BlockId[];
}

interface TableCellBlock {
  type: "table-cell";
  attrs?: TableCellAttrs;
  /** Empty content is a valid (empty) cell. */
  content?: BlockContent;
  /** Leaf block types only. */
  children?: BlockId[];
}

export type { TableAttrs, TableBlock, TableCellBlock, TableRowBlock };
