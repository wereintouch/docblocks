/** The consumer's per-table section settings: the values that belong to
 *  the table itself rather than to a document block. The consumer owns the
 *  storage (its own table registry); the package reads the values as the
 *  block's fallback and writes them back over the section's own grid. */
interface DatabaseTableSection {
  /** The table's persisted header-row height (px); `undefined` stands none
   *  (the block's own attr over it, else the auto height). */
  getHeaderHeight?: (tableId: string) => number | undefined;
  /** Commits the header-row height for the table (the section's grid drag's
   *  release): one value over every block referencing the table. */
  setHeaderHeight?: (tableId: string, height: number) => void;
  /** The consumer's authoritative total row count; `undefined` lets the
   *  grid fall back to its loaded rows. The interface is a read, not a
   *  subscription: the consumer re-renders when its count changes. */
  getRowCount?: (tableId: string) => number | undefined;
}

export type { DatabaseTableSection };
