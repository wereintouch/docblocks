/** The read unit's intermediate shape: the block snapshot being assembled. */
import type { BlockId, BlockType, TextRun } from "@docblocks-core/schema";

/** Intermediate shape while a block snapshot is being assembled. */
interface BlockDraft {
  type: BlockType;
  attrs?: unknown;
  /** The canvas geometry as a plain object of numbers (any block type). */
  geometry?: unknown;
  content?: TextRun[];
  children?: BlockId[];
  rows?: Record<string, Record<string, unknown>>;
  rowOrder?: string[];
  /** The column identities + order (table only): the single source of the column set. */
  columnOrder?: string[];
}

export type { BlockDraft };
