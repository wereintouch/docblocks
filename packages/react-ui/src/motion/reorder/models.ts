/** The visible row's settled geometry (the static layout, the rows'
 * mid-slide positions are not measured) + the block's current indent. */
import type { BlockId } from "docblocks-core";

interface DropRow {
  id: BlockId;
  top: number;
  bottom: number;
  indent: number;
}

export type { DropRow };
