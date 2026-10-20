/**
 * The external-form database grid: the live table view over the bridge
 * (the schema + the rows + the live events). The view settings are the
 * block's attrs (the `filter`, the `columnOrder`, the `hiddenColumns`, the
 * `name` display override) written via `updateBlock` (CRDT data,
 * undo-able); the table data itself is the consumer's database (the
 * bridge is the source of truth). The cell editing commits one
 * `bridge.updateRow` per cell (the optimistic layer + the forward-only
 * undo live in the `useDatabaseTable` provider).
 *
 * The layout is a single CSS grid (the header row and the data rows share
 * the column tracks, so the header and the rows always stand aligned):
 * one `minmax` track per visible column + the row-menu track. The column
 * drag (a press-drag over a header cell, like the table block's column
 * handles) previews the live transform (pure view state) and commits the
 * `columnOrder` attr on the release — one `updateBlock`, one undo step,
 * one wire update; a stale drop (a peer restructured the columns) issues
 * nothing.
 */
import type { BlockId, DatabaseBlock as DatabaseBlockType } from "docblocks-core";

import { useEditorContext } from "../../EditorProvider";
import { GridBody } from "./GridBody";

function DatabaseGrid({ id, block }: { id: BlockId; block: DatabaseBlockType }) {
  const { doc, databaseBridge } = useEditorContext();
  const tableId = block.attrs.tableId;
  if (tableId === undefined) {
    // The inline form: the built-in placeholder card stands (the caller
    // branches); this is the unreachable guard.
    return null;
  }
  return (
    <GridBody
      id={id}
      doc={doc}
      blockId={id}
      bridge={databaseBridge}
      tableId={tableId}
      filter={block.attrs.filter}
      columnOrder={block.attrs.columnOrder}
      hiddenColumns={block.attrs.hiddenColumns}
      columnWidths={block.attrs.columnWidths}
    />
  );
}

export { DatabaseGrid };
