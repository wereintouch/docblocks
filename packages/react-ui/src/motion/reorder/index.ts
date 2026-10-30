// The flat-row drag commit's cross-unit surface (the motion view, pure
// framer Reorder over the flat page sequence): the commit (the range
// move of the dragged block's derived subtree within the container's
// sequence + the seam's indent assignment — one transact, one undo
// step, one wire update), the seam's candidate indent (the drop's
// two-variant rule), the tail seat's clamp (the preview side of the
// commit's tail landing), the same-ids check.
export type { DropRow } from "./models";
export { dropCandidateIndent } from "./seam";
export { clampTailSeatCrossing, commitFlatDrag, sameIds } from "./commit";
