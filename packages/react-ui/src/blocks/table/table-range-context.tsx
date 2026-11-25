/**
 * The table cell range's handlers over the table's subtree: the cells render
 * the corner grip and hand its pointer events to the table-level session
 * (`useTableCellRange`), so a cell needs no session state of its own.
 */
import { createContext, useContext } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import type { BlockId } from "docblocks-core";

interface TableCellRangeHandlers {
  /** The press on the cell's corner grip: the range starts at the cell. */
  onGripPointerDown: (cellId: BlockId) => (event: ReactPointerEvent<HTMLElement>) => void;
  /** The drag over the cells (the pointer capture keeps the events on the grip). */
  onGripPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  /** The release: the range stays as it stands. */
  onGripPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
}

const TableCellRangeContext = createContext<TableCellRangeHandlers | null>(null);

/** The table's range handlers; null outside a table (the grip never renders). */
function useTableCellRangeHandlers(): TableCellRangeHandlers | null {
  return useContext(TableCellRangeContext);
}

export { TableCellRangeContext, useTableCellRangeHandlers };
export type { TableCellRangeHandlers };
