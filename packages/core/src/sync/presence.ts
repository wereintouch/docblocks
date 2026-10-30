import type { Selection } from "@docblocks-core/core";

import type { PresenceSelection } from "./models";

/**
 * The wire form of a view selection for the presence payload: a caret, a
 * range, or block ids. UX-only fields (drag direction, block anchor) stay
 * client-side and never travel the wire.
 */
function presenceSelectionOf(selection: Selection): PresenceSelection | null {
  if (selection.kind === "none") return null;
  if (selection.kind === "blocks") return { blocks: [...selection.ids] };
  const from = { blockId: selection.from.blockId, offset: selection.from.offset };
  if (selection.to === null) return { blockId: from.blockId, offset: from.offset };
  const to = { blockId: selection.to.blockId, offset: selection.to.offset };
  if (selection.blocks !== undefined && selection.blocks.length > 0) {
    return { from, to, blocks: [...selection.blocks] };
  }
  return { from, to };
}

export { presenceSelectionOf };
