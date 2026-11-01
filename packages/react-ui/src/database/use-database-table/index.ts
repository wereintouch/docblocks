/** The database table unit's barrel: the external-form data provider (the
 *  `useDatabaseTable` hook over the bridge contract) + the cell-value
 *  equality the no-write guard reads. */
export { PAGE_SIZE } from "./constants";
export { useDatabaseTable } from "./use-database-table";
export type { DatabaseTablePhase, DatabaseTableRow, InverseOp, UseDatabaseTable } from "./models";
export { cellValueEqual, newMutationContext } from "./utils";
