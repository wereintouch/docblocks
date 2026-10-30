/** The table block's constants (the handle / add-chip geometry, the drag
 * thresholds and steps, the column-width floor). */
import { DEFAULT_TABLE_COLUMN_WIDTH } from "docblocks-core";
import type { BlockId } from "docblocks-core";

const EMPTY_IDS: BlockId[] = [];
// The handle zone: the 20 px band above the table (the column handles) and
// left of the table (the row handles), reserved inside the scroll content
// so the handles stand outside the table's box yet scroll with it (a
// column scrolled out of view takes its handle with it).
const HANDLE_ZONE = 20;
// The handle chip size (px) — the chips center on the column / the row.
const HANDLE_SIZE = 20;
// The add-row / add-column chip size (px) — the row chip's left offset is
// computed against it.
const ADD_BUTTON_SIZE = 24;
// The pointer travel before a handle press becomes a drag (a shorter press
// is a click and opens the handle's menu).
const DRAG_THRESHOLD = 4;
// The add chip's drag step: the rows stand the row's travel (24 px per
// row), the columns stand the base column's width (a whole column's
// travel adds one — the ghosts stand the same width).
const ADD_ROW_DRAG_STEP_PX = 24;
const ADD_COLUMN_DRAG_STEP_PX = DEFAULT_TABLE_COLUMN_WIDTH;
// The ghost row's height (the add preview's rows stand the table's minimum
// row height — the real rows' heights are content-dependent).
const GHOST_ROW_HEIGHT = 28;
/** The minimum width a column can be resized to (px; a drag below it clamps).
 */
const MIN_COLUMN_WIDTH = 50;
// The add chips stand hidden until the table frame is hovered or holds the
// focus (typing in a cell keeps them up), like the code header's controls.
const ADD_BUTTON_CLASSES =
  "pointer-events-none opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100";

const DRAG_TRANSITION = "transform 120ms ease-out";
const HANDLE_DRAG_TRANSITION = "left 120ms ease-out, top 120ms ease-out";

export {
  ADD_BUTTON_CLASSES,
  ADD_BUTTON_SIZE,
  ADD_COLUMN_DRAG_STEP_PX,
  ADD_ROW_DRAG_STEP_PX,
  DRAG_THRESHOLD,
  EMPTY_IDS,
  GHOST_ROW_HEIGHT,
  HANDLE_SIZE,
  HANDLE_ZONE,
  MIN_COLUMN_WIDTH,
  DRAG_TRANSITION,
  HANDLE_DRAG_TRANSITION,
};
