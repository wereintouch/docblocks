/** The playground consumer's per-table settings, shared by both grid surfaces. */
import type { DatabaseTableSection } from "docblocks-react-ui";

import { persistentDatabaseBridge } from "./persistent-bridge";

const headerHeights = new Map<string, number>();

const databaseTableSection: DatabaseTableSection = {
  getHeaderHeight: (tableId) => headerHeights.get(tableId),
  setHeaderHeight: (tableId, height) => {
    headerHeights.set(tableId, height);
  },
  getRowCount: (tableId) => persistentDatabaseBridge.getRowCount(tableId),
};

export { databaseTableSection };
