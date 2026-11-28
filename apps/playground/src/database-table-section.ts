/** The playground consumer's per-table settings, shared by both grid surfaces. */
import type { DatabaseTableSection } from "docblocks-react-ui";

import { persistentDatabaseBridge } from "./persistent-bridge";

const headerHeights = new Map<string, number>();

const databaseTableSection: DatabaseTableSection = {
  getHeaderHeight: (tableId) => headerHeights.get(tableId),
  setHeaderHeight: (tableId, height) => {
    // The `undefined`'s stand (the double-click's reset): the value's
    // removal (the auto height's return), not a stored undefined.
    if (height === undefined) headerHeights.delete(tableId);
    else headerHeights.set(tableId, height);
  },
  getRowCount: (tableId) => persistentDatabaseBridge.getRowCount(tableId),
};

export { databaseTableSection };
