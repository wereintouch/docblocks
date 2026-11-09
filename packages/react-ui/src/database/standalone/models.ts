import type { DatabaseFilterPayload } from "docblocks-core";

import type { BridgeError, TableRef } from "../bridge";

/**
 * The database table's view settings — the standalone's `DatabaseTable`
 * stand over the block's view attrs: the `filter`, the `columnOrder`, the
 * `hiddenColumns`, the `columnWidths`, and the legacy `name` (the display
 * stands the bridge's table name, as over the block — the `name` attr is
 * the persistence's parity, not a display override). The schema's
 * `views` / `viewType` attrs stand out of the UI's v1 (the view's kinds
 * are unrendered).
 */
interface DatabaseTableView {
  /** The display name's legacy parity (the bridge's table name stands the display). */
  name?: string;
  /** The applied filter (the block's `filter` attr's payload shape). */
  filter?: DatabaseFilterPayload;
  /** The visible columns' order (the drag's committed stand). */
  columnOrder?: string[];
  /** The hidden columns' ids (the column menu's toggle stand). */
  hiddenColumns?: string[];
  /** The columns' widths (px, over the `columnOrder` positions). */
  columnWidths?: number[];
}

/** The `useTableList`'s return: the catalog's read projection + the create / rename's mutations. */
interface UseTableList {
  /** The catalog's tables (the system tables stand absent); `null` until the first successful read. */
  tables: TableRef[] | null;
  /** The catalog read's in-flight stand. */
  loading: boolean;
  /** The catalog read's last error (the `BridgeError` stand — the create / rename's failures stand their promises' rejects). */
  error: BridgeError | null;
  /** The catalog's re-read (the manual's stand — the contract's catalog stands no push). */
  refresh: () => Promise<void>;
  /** The `createTable`'s mutation (the fresh's `operationId` per op; rejects with the `BridgeError`). Resolves the created table's ref. */
  create: (name: string) => Promise<TableRef>;
  /** The `renameTable`'s mutation (the fresh's `operationId` per op; rejects with the `BridgeError`). */
  rename: (tableId: string, name: string) => Promise<void>;
}

export type { DatabaseTableView, UseTableList };
