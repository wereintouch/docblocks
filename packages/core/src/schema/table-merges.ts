/**
 * Normalization of the table cell spans over a JSON snapshot. The anchor
 * cell's `colspan`/`rowspan` is a derived stand like the canvas `zIndex`: a
 * concurrent merge (a peer's delete against the other's edit, two merges over
 * the same rows) can leave a span running past the table's edge or onto a
 * coordinate another anchor already covers. This helper re-derives the
 * EFFECTIVE span — the span the resolver would place — onto the anchor cells,
 * so the snapshot is valid again; the cells and their bindings stay untouched
 * (the covered-cell residue the validator reports, the renderer still draws).
 *
 * Idempotent and byte-stable on a normalized input: only the anchors whose
 * requested span was clamped are rewritten (the others share their entry).
 * Pure JSON → JSON (no CRDT).
 */
import { buildTableGrid } from "./table-grid";
import type { GridCellInput } from "./table-grid";
import type { DocJSON } from "./types";
import { isPlainObject } from "./utils";

/** The non-negative integer stand of a raw span (the placement sanitizes anyway). */
function rawSpan(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 1;
}

/** The column binding of a raw cell (a non-string stand is unbound). */
function rawColumnId(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function normalizeMerges(json: DocJSON): DocJSON {
  const source = json.blocks as unknown as Record<string, Record<string, unknown>>;
  const blocks: Record<string, unknown> = { ...source };
  let changed = false;
  for (const block of Object.values(source)) {
    if (!isPlainObject(block) || block.type !== "table") continue;
    const columnOrder = (block as { columnOrder?: unknown }).columnOrder;
    if (!Array.isArray(columnOrder)) continue; // the table's own error
    const columnIds = columnOrder.filter((id): id is string => typeof id === "string");
    const rowIds = Array.isArray((block as { children?: unknown }).children)
      ? (block as { children: unknown[] }).children.filter((id): id is string => typeof id === "string")
      : [];
    const rows: GridCellInput[][] = rowIds.map((rowId) => {
      const row = source[rowId];
      if (row === undefined || !isPlainObject(row) || !Array.isArray(row.children)) return [];
      return (row.children as unknown[])
        .filter((cellId): cellId is string => typeof cellId === "string")
        .map((cellId) => {
          const cell = source[cellId];
          const attrs = cell !== undefined && isPlainObject(cell.attrs) ? cell.attrs : {};
          return {
            id: cellId,
            columnId: rawColumnId(attrs.columnId),
            colspan: rawSpan(attrs.colspan),
            rowspan: rawSpan(attrs.rowspan),
          };
        });
    });
    const { clamped } = buildTableGrid(columnIds, rows);
    for (const anchor of clamped) {
      const cell = source[anchor.id];
      if (cell === undefined) continue;
      const attrs = isPlainObject(cell.attrs) ? { ...cell.attrs } : {};
      if (anchor.colspan === 1) delete attrs.colspan;
      else attrs.colspan = anchor.colspan;
      if (anchor.rowspan === 1) delete attrs.rowspan;
      else attrs.rowspan = anchor.rowspan;
      blocks[anchor.id] = { ...cell, attrs };
      changed = true;
    }
  }
  return changed ? ({ ...json, blocks } as DocJSON) : json;
}

export { normalizeMerges };
