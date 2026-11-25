/**
 * The table grid's resolver: the placement of a table's cells over the grid
 * coordinates. A merged region is one ANCHOR cell (its `colspan`/`rowspan`
 * attrs) standing at its top-left coordinate; the cells the region covers are
 * absent from the row, so a row's cell list is not one cell per column any
 * more. Every consumer that needs the grid (the validator, the merge
 * normalization, the commands, the renderer) resolves it here instead of
 * reading cell positions.
 *
 * The placement is binding-driven: a cell's `columnId` stands its grid
 * column (the covered cells' absence is what makes the binding, not the
 * position, the source of the cell's column). An unbound cell (the legacy
 * row form) and a cell whose binding stands over an occupied position land in
 * the next free slot — the corrupt-input stand the validator reports and the
 * renderer still draws.
 *
 * The spans shrink to the free space: a `colspan`/`rowspan` that would run
 * past the table's edge or onto an occupied coordinate is clamped (the
 * effective span is what the resolver and the read-path normalization stand).
 *
 * Pure: no doc / CRDT access — the callers read the rows and the column set.
 */

/** The cell's grid input: the identity, the column binding, and the raw spans. */
interface GridCellInput {
  id: string;
  /** The `columnId` binding; `null` over a legacy unbound cell. */
  columnId: string | null;
  /** The requested span over the columns (>= 1). */
  colspan: number;
  /** The requested span over the rows (>= 1). */
  rowspan: number;
}

/** A placed cell: the anchor of a grid region. */
interface GridAnchor {
  id: string;
  columnId: string | null;
  /** The grid row of the region's top edge. */
  row: number;
  /** The grid column of the region's left edge. */
  col: number;
  /** The effective column span (clamped to the free space). */
  colspan: number;
  /** The effective row span (clamped to the free space). */
  rowspan: number;
}

/** The resolved grid: the anchors and the coordinate lookups. */
interface TableGrid {
  /** The grid's column count (the table's `columnOrder` length). */
  cols: number;
  /** The grid's row count (the table's row count). */
  rowCount: number;
  /** The anchors per grid row (top edges only), in grid-column order. */
  rows: GridAnchor[][];
  /** The anchor standing at the coordinate (a covered position returns its anchor); `null` over a void position. */
  cellAt(row: number, col: number): GridAnchor | null;
  /** The anchors the rectangle touches (a merge's validity reads them). */
  anchorsIn(top: number, left: number, bottom: number, right: number): GridAnchor[];
}

/** The build's result: the grid + the raw-span defects. */
interface TableGridBuild {
  grid: TableGrid;
  /** The anchors whose requested span was clamped (by the edge or an occupied coordinate). */
  clamped: GridAnchor[];
  /** The cell ids whose binding stood over an occupied position (the placement fell back to a free slot). */
  collisions: string[];
  /** The cell ids left without a slot (an overfull row — the cell list outruns the columns). */
  overflow: string[];
}

/** The span normalization: a non-positive / non-finite stand is 1. */
function spanOfValue(value: number): number {
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
}

/**
 * Places the rows' cells over the grid: the anchors (the top-left cells of
 * the regions), their effective spans, and the coordinate lookups.
 */
function buildTableGrid(columnIds: readonly string[], rowsIn: readonly (readonly GridCellInput[])[]): TableGridBuild {
  const cols = columnIds.length;
  const rowCount = rowsIn.length;
  const columnIndex = new Map<string, number>(columnIds.map((id, index) => [id, index]));
  const occupied: (GridAnchor | null)[][] = rowsIn.map(() => new Array<GridAnchor | null>(cols).fill(null));
  const anchors: GridAnchor[] = [];
  const clamped: GridAnchor[] = [];
  const collisions: string[] = [];
  const overflow: string[] = [];

  const standsFree = (row: number, col: number): boolean =>
    row >= 0 && row < rowCount && col >= 0 && col < cols && occupied[row]![col] === null;

  const place = (cell: GridCellInput, row: number): void => {
    if (cols === 0 || row >= rowCount) {
      overflow.push(cell.id);
      return;
    }
    const bound = cell.columnId === null ? undefined : columnIndex.get(cell.columnId);
    // The binding stands the column when its coordinate is free; otherwise
    // the cell takes the next free slot from the row's cursor (the corrupt
    // input the validator reports, still drawn).
    let col = bound !== undefined && standsFree(row, bound) ? bound : -1;
    if (col === -1) {
      if (bound !== undefined) collisions.push(cell.id);
      col = 0;
      while (col < cols && !standsFree(row, col)) col += 1;
    }
    if (col >= cols) {
      overflow.push(cell.id);
      return;
    }
    const colspanAsked = Math.min(spanOfValue(cell.colspan), cols - col);
    const rowspanAsked = Math.min(spanOfValue(cell.rowspan), rowCount - row);
    let colspan = 1;
    while (colspan < colspanAsked && standsFree(row, col + colspan)) colspan += 1;
    let rowspan = 1;
    while (rowspan < rowspanAsked) {
      let free = true;
      for (let c = 0; c < colspan; c += 1) {
        if (!standsFree(row + rowspan, col + c)) {
          free = false;
          break;
        }
      }
      if (!free) break;
      rowspan += 1;
    }
    const anchor: GridAnchor = { id: cell.id, columnId: cell.columnId, row, col, colspan, rowspan };
    if (colspan !== spanOfValue(cell.colspan) || rowspan !== spanOfValue(cell.rowspan)) clamped.push(anchor);
    for (let r = 0; r < rowspan; r += 1) {
      const line = occupied[row + r];
      if (line === undefined) break;
      for (let c = 0; c < colspan; c += 1) line[col + c] = anchor;
    }
    anchors.push(anchor);
  };

  rowsIn.forEach((cells, row) => {
    for (const cell of cells) place(cell, row);
  });

  const gridRows: GridAnchor[][] = rowsIn.map(() => []);
  for (const anchor of anchors) gridRows[anchor.row]!.push(anchor);
  for (const line of gridRows) line.sort((a, b) => a.col - b.col);

  const grid: TableGrid = {
    cols,
    rowCount,
    rows: gridRows,
    cellAt(row, col) {
      if (row < 0 || row >= rowCount || col < 0 || col >= cols) return null;
      return occupied[row]![col] ?? null;
    },
    anchorsIn(top, left, bottom, right) {
      const found = new Set<GridAnchor>();
      for (let row = top; row <= bottom && row < rowCount; row += 1) {
        for (let col = left; col <= right && col < cols; col += 1) {
          const anchor = row >= 0 && col >= 0 ? occupied[row]![col] : null;
          if (anchor !== null && anchor !== undefined) found.add(anchor);
        }
      }
      return [...found];
    },
  };

  return { grid, clamped, collisions, overflow };
}

export { buildTableGrid, spanOfValue };
export type { GridAnchor, GridCellInput, TableGrid, TableGridBuild };
