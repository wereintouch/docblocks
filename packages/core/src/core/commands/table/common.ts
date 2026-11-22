/** Shared table layout primitives: the Yjs accessors (typed errors on a
 * corrupt layout), the value checks, the `columnWidths`/`cols`/color
 * writes, and the subtree-copy helpers. They run inside the caller's
 * transaction; none of them opens a transaction of its own. The modules'
 * split: the layout's accessors + the structural bounds (common-layout),
 * the value's checks + the widths + the colors (common-values), the
 * subtree-copy's helpers (common-copy). */
import { DEFAULT_TABLE_COLUMN_WIDTH } from "@docblocks-core/schema";

export {
  assertIndex,
  assertInsertIndex,
  assertValidCellColumnBinding,
  cellsOf,
  columnOrderOf,
  rowOf,
  rowsOf,
  tableOf,
} from "./common-layout";
export {
  assertCellColor,
  assertWidth,
  ensureWidthsMap,
  readCellColor,
  readWidthOf,
  setCellColor,
  widthsMap,
  writeColumnWidthsPatch,
} from "./common-values";
export {
  clearBlockChildren,
  collectSubtree,
  convertToParagraph,
  snapshotSubtree,
  writeSubtreeCopy,
} from "./common-copy";
export { DEFAULT_TABLE_COLUMN_WIDTH };
