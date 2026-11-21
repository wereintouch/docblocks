/** The flat page model's read-only filter: the empty text chain's collapse
 *  (the view / published's modes' render filter — the data stands untouched). */
import type { BlockId } from "docblocks-core";

import type { FlatNode } from "./flat";

/**
 * The read-only stand's empty text chain's collapse (the view / published's
 * modes' render filter — the data stands untouched): two or more
 * CONSECUTIVE nodes of one indent, each a text type with no derived
 * children and the empty's text, stand rendered as one (the chain's first
 * block stands the chain; the rest stand no stand). A non-empty node, a
 * node with children, or an indent's change breaks the chain.
 */
/** The text types over the empty chain's collapse (the empty's stand: the
 *  zero text's length + no children). */
const EMPTY_CHAIN_TYPES = new Set(["paragraph", "heading", "quote", "callout", "list-item", "code"]);

/** The block's empty's stand (a text type with the zero text's length). */
function isEmptyChainText(block: unknown): boolean {
  if (block === null || block === undefined) return false;
  const candidate = block as { type: string; content?: readonly { text: string }[] };
  return EMPTY_CHAIN_TYPES.has(candidate.type) && (candidate.content ?? []).every((run) => run.text === "");
}

function collapseEmptyTextChains(nodes: FlatNode[], isEmptyText: (id: BlockId) => boolean): FlatNode[] {
  const result: FlatNode[] = [];
  let chainIndent = -1;
  for (const node of nodes) {
    const empty = node.children.length === 0 && isEmptyText(node.id);
    if (empty) {
      // The chain's start stands; the continuation's stand is dropped
      // (the same indent's parity — a deeper node is a new chain).
      if (node.indent === chainIndent) continue;
      chainIndent = node.indent;
      result.push(node);
      continue;
    }
    chainIndent = -1;
    result.push(node);
  }
  return result;
}

export { collapseEmptyTextChains, isEmptyChainText };
