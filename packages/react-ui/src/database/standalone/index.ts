/**
 * The standalone's database's surface (the consumer's own page, not a
 * document block): the `DatabaseTable` component (the live grid over the
 * bridge's table id) + the `useTableList` hook (the catalog's read + the
 * create / rename's mutations). The block's surface stands the `grid`'s
 * unit over the document.
 */
export { DatabaseTable } from "./DatabaseTable";
export { useTableList } from "./use-table-list";
export type { DatabaseTableView, UseTableList } from "./models";
export type { DatabaseTableProps } from "./DatabaseTable";
