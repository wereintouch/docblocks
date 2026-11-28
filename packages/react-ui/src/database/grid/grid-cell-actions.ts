import type { UseDatabaseTable } from "../use-database-table";

/** Clears every selected cell in one bridge batch and one history entry. */
function clearGridCells(selectedCells: Set<string>, data: UseDatabaseTable): Promise<void> {
  const byRow = new Map<string, Record<string, unknown>>();
  selectedCells.forEach((key) => {
    const [rowId, colId] = key.split("\u0000");
    if (rowId === undefined || colId === undefined) return;
    // Column ids are data; a null-prototype record keeps every id an own entry.
    const cells = byRow.get(rowId) ?? Object.create(null);
    cells[colId] = null;
    byRow.set(rowId, cells);
  });
  return data.updateRows([...byRow.entries()].map(([rowId, cells]) => ({ rowId, cells })));
}

/** Returns the selected row ids once, in the selection's row-major order. */
function selectedGridRowIds(selectedCells: Set<string>): string[] {
  const ids = new Set<string>();
  selectedCells.forEach((key) => {
    const [rowId] = key.split("\u0000");
    if (rowId !== undefined) ids.add(rowId);
  });
  return [...ids];
}

export { clearGridCells, selectedGridRowIds };
