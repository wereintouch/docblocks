/**
 * The in-memory bridge's read path (over the core): the snapshot (the sole
 * initial read — the page + the signed boundary `R` + the semantics), the
 * page's continuation (the cursor's verification: the tampered / the
 * foreign key's token rejects before the expiry / the fingerprint / the
 * boundary checks), and the row's display value (the reference display
 * over the cell's value).
 */
import type { Column, PageQuery, PageSnapshot, TableSnapshot } from "docblocks-react-ui";
import { BridgeError, TEXT_TYPES } from "docblocks-react-ui";

import { DEFAULT_LIMIT, MAX_REQUEST_BYTES } from "./constants";
import type { MemoryBridgeCore } from "./core";
import { verifyCursor } from "./cursor";
import { buildCursor, orderedQueryRows, queryFingerprint, semanticsOf, validateQuery } from "./query";
import { formatCellDisplay, liveRowOf, rowWireOf, tableRefOf } from "./rows";
import { clone, jsonSizeOf } from "./utils";

async function snapshotTable(core: MemoryBridgeCore, tableId: string, query: PageQuery): Promise<TableSnapshot> {
  const table = core.tableOf(tableId);
  if (jsonSizeOf(query ?? null) > MAX_REQUEST_BYTES) {
    throw new BridgeError("payload_too_large", `The query exceeds the request limit of ${MAX_REQUEST_BYTES} bytes.`);
  }
  validateQuery(table, query);
  const limit = query.limit ?? DEFAULT_LIMIT;
  const R = table.headSeq;
  const rows = orderedQueryRows(table, query.filter, query.sort);
  const pageRows = rows.slice(0, limit);
  return {
    table: tableRefOf(table),
    columns: clone(table.columns),
    schemaRevision: table.schemaRevision,
    page: {
      rows: pageRows.map(rowWireOf),
      nextCursor:
        pageRows.length > 0 && pageRows.length < rows.length
          ? buildCursor(core.cursorKey, table, R, query.filter, query.sort, limit, pageRows[pageRows.length - 1]!)
          : null,
      asOfSeq: R,
      schemaRevision: table.schemaRevision,
      queryFingerprint: queryFingerprint(core.cursorKey, table, R, query.filter, query.sort, limit),
      semantics: semanticsOf(table),
    },
  };
}

async function queryNextPage(
  core: MemoryBridgeCore,
  tableId: string,
  input: { cursor: string; asOfSeq: number; queryFingerprint: string }
): Promise<PageSnapshot> {
  const table = core.tableOf(tableId);
  // The signature stands first: the tampered payload / the foreign key's
  // token rejects before the expiry / the fingerprint / the boundary
  // checks (the verified payload is the only trusted input).
  const cursor = verifyCursor(core.cursorKey, input.cursor);
  if (
    cursor === null ||
    cursor.tableId !== tableId ||
    cursor.R !== input.asOfSeq ||
    input.asOfSeq !== table.headSeq ||
    cursor.fp !== input.queryFingerprint ||
    cursor.fp !==
      queryFingerprint(
        core.cursorKey,
        table,
        input.asOfSeq,
        cursor.filter ?? undefined,
        cursor.sort ?? undefined,
        cursor.limit
      )
  ) {
    throw new BridgeError(
      "cursor_expired",
      "The page cursor is stale, foreign, or bound to a different snapshot or query."
    );
  }
  const rows = orderedQueryRows(table, cursor.filter ?? undefined, cursor.sort ?? undefined);
  let start = 0;
  if (cursor.afterOrderKey !== null && cursor.afterRowId !== null) {
    const at = rows.findIndex((row) => row.orderKey === cursor.afterOrderKey && row.id === cursor.afterRowId);
    if (at === -1) throw new BridgeError("cursor_expired", "The page cursor's position no longer exists in the table.");
    start = at + 1;
  }
  const pageRows = rows.slice(start, start + cursor.limit);
  return {
    rows: pageRows.map(rowWireOf),
    nextCursor:
      pageRows.length > 0 && start + pageRows.length < rows.length
        ? buildCursor(
            core.cursorKey,
            table,
            input.asOfSeq,
            cursor.filter ?? undefined,
            cursor.sort ?? undefined,
            cursor.limit,
            pageRows[pageRows.length - 1]!
          )
        : null,
    asOfSeq: input.asOfSeq,
    schemaRevision: table.schemaRevision,
    queryFingerprint: input.queryFingerprint,
    semantics: semanticsOf(table),
  };
}

async function resolveRowDisplay(
  core: MemoryBridgeCore,
  tableId: string,
  input: { rowIds: string[]; displayColumn?: string }
): Promise<Record<string, string | null>> {
  const table = core.tableOf(tableId);
  const rowIds = Array.isArray(input.rowIds) ? input.rowIds : [];
  let column: Column | undefined;
  if (input.displayColumn !== undefined) column = table.columns.find((entry) => entry.id === input.displayColumn);
  if (column === undefined) {
    column = table.columns.find((entry) => TEXT_TYPES.has(entry.type.replace(/\[\]$/, "").trim())) ?? table.columns[0];
  }
  const displays: Record<string, string | null> = {};
  for (const rowId of rowIds) {
    const row = liveRowOf(table, rowId);
    displays[rowId] = row === undefined || column === undefined ? null : formatCellDisplay(row.cells[column.id]);
  }
  return displays;
}

export { queryNextPage, resolveRowDisplay, snapshotTable };
