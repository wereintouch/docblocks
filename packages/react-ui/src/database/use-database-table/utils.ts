/** The database table hook's pure helpers (the cell-value equality). */

/** The cell-value equality (null / undefined stand as the empty cell). */
function cellValueEqual(current: unknown, next: unknown): boolean {
  if (current === undefined || current === null) return next === undefined || next === null;
  return current === next;
}

export { cellValueEqual };
