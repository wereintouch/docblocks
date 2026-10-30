/**
 * Selection — per-view selection state (model, rebase, undo-caret).
 * The cross-unit surface: the SelectionView + the selection types, plus the
 * linearize / Linearizable the text-range command reads.
 */
export { SelectionView, createSelection } from "./selection";
export type { Selection, TextPoint } from "./models";
export { linearize } from "./rebase";
export type { Linearizable } from "./rebase";
