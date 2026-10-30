/** The layout's types: the Y.Map holding layout values + the block's written
 *  shape (the fields per the registry spec). */
import * as Y from "yjs";

import type { BlockType, TextRun } from "@docblocks-core/schema";

/** Y.Map holding layout values: primitives or nested Y types. */
type AnyMap = Y.Map<unknown>;

/** Shape of a block as written into the layout (fields per the registry spec). */
interface WritableBlock {
  type: BlockType;
  attrs?: unknown;
  /** The canvas geometry: a plain object of numbers (any block type). */
  geometry?: unknown;
  content?: readonly TextRun[];
  children?: readonly string[];
  rows?: Record<string, Record<string, unknown>>;
  rowOrder?: string[];
  /** The column identities + order (table only): the single source of the column set. */
  columnOrder?: string[];
}

export type { AnyMap, WritableBlock };
