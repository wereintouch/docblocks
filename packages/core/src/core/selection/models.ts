/**
 * Per-view selection: client/view state, not document data.
 *
 * Never in the JSON, never in document updates, never in the document's
 * undo history — the one exception: undo/redo RESTORES the local selection
 * (the standard editor undo-selection semantics): each captured local edit
 * snapshots the selection
 * it started from, and undo/redo overwrite the selection with that snapshot
 * after the rebase has run (restoration wins). Remote changes only rebase;
 * they never restore. A document can host several independent views;
 * `destroy()` releases a view's document subscriptions when it is no longer
 * needed.
 */
import type { BlockId } from "@docblocks-core/schema";

/** A point in a block's flattened text: 0 <= offset <= textLength(blockId). */
type TextPoint = { blockId: BlockId; offset: number };

/** The view-local selection state. */
type Selection =
  | { kind: "none" }
  | {
      kind: "text";
      from: TextPoint;
      /** null = caret. */
      to: TextPoint | null;
      /** Ordered DFS chain, from-block first, to-block last (single-block: [blockId]). Engine-maintained: computed on set/rebase; a provided chain is validated, not fixed. */
      blocks?: BlockId[];
      /** Drag direction (UX state; preserved by rebase). */
      reverse?: boolean;
    }
  | { kind: "blocks"; ids: BlockId[]; anchorId: BlockId };

/** Undo-manager event payload (structural subset: the stack item's meta map). */
type StackItemEventLike = { stackItem: { meta: Map<unknown, unknown> } };

export type { Selection, StackItemEventLike, TextPoint };
