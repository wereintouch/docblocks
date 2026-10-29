/** The in-memory bridge's pure helpers: the managed-column strip, the table-id
 *  derivation, and the cursor encoding. */
import { PK_COLUMN, ROW_ORDER_COLUMN } from "./constants";

/** The pk / the order column are bridge-managed: they are not cell data. */
function stripManaged(row: Record<string, unknown>): Record<string, unknown> {
  const cells: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === PK_COLUMN || key === ROW_ORDER_COLUMN) continue;
    cells[key] = value;
  }
  return cells;
}

/** The table id derived from the name (deterministic across the channel's instances). */
function tableIdFor(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `table-${slug || Math.random().toString(36).slice(2, 8)}`;
}

function encodeCursor(index: number): string {
  return `i${index}`;
}

function decodeCursor(cursor: string): number {
  const parsed = Number(cursor.slice(1));
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export { decodeCursor, encodeCursor, stripManaged, tableIdFor };
