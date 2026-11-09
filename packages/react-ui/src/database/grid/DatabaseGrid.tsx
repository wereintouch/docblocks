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
 * Without a bridge the grid renders the disconnected placeholder (the
 * consumer supplied no `databaseBridge` prop) — the block stands in the
 * document, the gutter / the selection and the block commands keep
 * working over it, and the data itself stays in the consumer's own stand
 * (the document keeps only the `tableId` reference).
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
import { useTranslation } from "react-i18next";

import type { BlockId, DatabaseBlock as DatabaseBlockType } from "docblocks-core";

import { useEditorContext } from "../../editor-provider";
import { Badge } from "../../shared/ui/Badge";
import { Card, CardContent } from "../../shared/ui/Card";
import { GridBody } from "./GridBody";

/** The no-bridge stand: the consumer supplied no `databaseBridge` — the
 *  block's data lives in the consumer's own stand, and the grid renders
 *  the disconnected note (the block stays selectable / movable over the
 *  gutter, the inline form stands unchanged). */
function DatabaseDisconnected({ name }: { name?: string }) {
  const { t } = useTranslation("database");
  return (
    <Card
      data-slot="docblocks/database-disconnected"
      className="
        my-(--docblocks-block-spacing) rounded-(--docblocks-radius) border-(length:--docblocks-table-border-width)
        border-(--docblocks-table-border-color) outline-none
      "
    >
      <CardContent
        data-slot="docblocks/database"
        className="flex items-center justify-between gap-(--docblocks-block-spacing)"
      >
        <span className="font-(--docblocks-heading-font-weight)">{name ?? t("disconnected.name")}</span>
        <Badge data-slot="docblocks/database-disconnected-note" variant="secondary" className="shrink-0">
          {t("disconnected.note")}
        </Badge>
      </CardContent>
    </Card>
  );
}

function DatabaseGrid({ id, block }: { id: BlockId; block: DatabaseBlockType }) {
  const { doc, databaseBridge, viewMode } = useEditorContext();
  const tableId = block.attrs.tableId;
  if (tableId === undefined) {
    // The inline form: the built-in placeholder card stands (the caller
    // branches); this is the unreachable guard.
    return null;
  }
  if (databaseBridge === undefined) {
    // The consumer supplied no bridge: the disconnected stand (the block
    // stands in the document, the data stays in the consumer's own stand).
    return <DatabaseDisconnected name={block.attrs.name} />;
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
      // The read-only stand (view / published): the grid's data stands
      // rendered, the editing's paths stand off.
      readOnly={viewMode}
    />
  );
}

export { DatabaseGrid };
