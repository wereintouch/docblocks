/**
 * Selection — per-view selection state (model, rebase, undo-caret).
 * Public surface only: the deltas/rebase internals are not re-exported.
 */
export { SelectionView, createSelection } from "./selection";
export type { Selection, TextPoint } from "./selection";
