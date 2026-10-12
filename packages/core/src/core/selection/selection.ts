import type { Transaction } from "yjs";

import { BLOCK_REGISTRY } from "@docblocks-core/schema";
import type { BlockId } from "@docblocks-core/schema";

import type { Doc } from "../doc";
import { DestroyedViewError, InvalidSelectionError } from "../errors";
import { onChange } from "../events";
import type { Change } from "../events";
import { undoManagerOf } from "../history";
import { localOriginOf } from "../layout";
import { trackBlockText } from "./deltas";
import type { TextDelta } from "./deltas";
import { chainBetween, linearize, rebaseSelection } from "./rebase";
import type { StructuralFacts } from "./rebase";

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

class SelectionView {
  readonly #doc: Doc;
  #state: Selection = { kind: "none" };
  readonly #listeners = new Set<(selection: Selection) => void>();
  /** Per-view meta key: the undo stack items are shared per doc across views. */
  readonly #metaKey: symbol;
  #trackers = new Map<BlockId, () => void>();
  /** Deltas composed since the last rebase, per block. */
  #pendingDeltas = new Map<BlockId, TextDelta[]>();
  /** Hub change waiting for the afterTransaction rebase. */
  #pendingChange: Change | null = null;
  /** The selection before the in-flight local/undo-transaction (undo-caret snapshot). */
  #pendingBefore: Selection | null = null;
  /** Document subscriptions, all released by destroy(). */
  #unsubDocChange: () => void;
  #onBeforeTransaction: (transaction: Transaction) => void;
  #onAfterTransaction: () => void;
  #onStackItemAdded: (event: StackItemEventLike) => void;
  #onStackItemPopped: (event: StackItemEventLike) => void;
  #destroyed = false;

  constructor(doc: Doc) {
    this.#doc = doc;
    this.#metaKey = Symbol("docblocks.selection");
    const ydoc = doc.raw;
    const manager = undoManagerOf(ydoc);
    const localOrigin = localOriginOf(ydoc);

    // Every subscription is captured for destroy(). Note: yjs ObservableV2's
    // on() returns the handler itself (not an unbind) — release is via
    // ydoc.off / manager.off with the stored reference.
    this.#unsubDocChange = onChange(ydoc, (change) => this.#onDocChange(change));
    // Snapshot at the start of every tracked transaction: the local edits and
    // the undo/redo inverse transactions (their origin is the manager itself).
    this.#onBeforeTransaction = (transaction) => {
      if (transaction.origin === localOrigin || transaction.origin === manager) {
        this.#pendingBefore = this.#state;
      }
    };
    // The rebase runs after all commit-phase observers (hub, trackers).
    this.#onAfterTransaction = () => this.#rebase();
    this.#onStackItemAdded = (event) => {
      const snapshot = this.#pendingBefore ?? this.#state;
      this.#pendingBefore = null;
      event.stackItem.meta.set(this.#metaKey, snapshot);
    };
    // Popped = the inverse has committed and the rebase has run: overwrite
    // the rebased selection with the snapshot (restoration wins, then emit).
    this.#onStackItemPopped = (event) => {
      const saved = event.stackItem.meta.get(this.#metaKey);
      if (saved === undefined) return; // captured before this view existed: rebase stands
      this.#state = saved as Selection;
      this.#emit();
      this.#reconcileTracking();
    };
    ydoc.on("beforeTransaction", this.#onBeforeTransaction);
    ydoc.on("afterTransaction", this.#onAfterTransaction);
    manager.on("stack-item-added", this.#onStackItemAdded);
    manager.on("stack-item-popped", this.#onStackItemPopped);
  }

  /** The current selection (a fresh plain snapshot on every call). */
  get(): Selection {
    return cloneSelection(this.#state);
  }

  /**
   * Replace the selection. Validates against the document and throws
   * InvalidSelectionError on violations. A pure view-state mutation: no
   * update, no undo step. Always emits the new state, even when identical.
   */
  set(selection: Selection): void {
    if (this.#destroyed) throw new DestroyedViewError("SelectionView is destroyed — the view is inert.");
    this.#state = normalizeSelection(this.#doc, selection);
    this.#emit();
    this.#reconcileTracking();
  }

  /**
   * Release every document subscription (change hub, transaction and
   * undo-manager listeners, per-block text trackers). Idempotent. The view
   * becomes inert: get() still returns the last state, set() throws, and
   * document changes no longer rebase or emit.
   */
  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#unsubDocChange();
    const ydoc = this.#doc.raw;
    ydoc.off("beforeTransaction", this.#onBeforeTransaction);
    ydoc.off("afterTransaction", this.#onAfterTransaction);
    undoManagerOf(ydoc).off("stack-item-added", this.#onStackItemAdded);
    undoManagerOf(ydoc).off("stack-item-popped", this.#onStackItemPopped);
    for (const unbind of [...this.#trackers.values()]) unbind();
    this.#trackers.clear();
    this.#pendingChange = null;
    this.#pendingDeltas = new Map();
    this.#pendingBefore = null;
  }

  /** Subscribe to selection changes (set, rebase, undo/redo restore). Returns unsubscribe. */
  onChange(handler: (selection: Selection) => void): () => void {
    this.#listeners.add(handler);
    return () => {
      this.#listeners.delete(handler);
    };
  }

  #emit(): void {
    for (const handler of [...this.#listeners]) handler(cloneSelection(this.#state));
  }

  #onDocChange(change: Change): void {
    const state = this.#state;
    if (state.kind === "none") return;
    // Cross-block: the chain spans a DFS interval; a change anywhere inside or
    // above it (e.g. an insertion under an ancestor of the endpoints) may
    // reshape it, so rebase on any change (the no-op check suppresses emission).
    if (state.kind === "text" && state.to !== null && state.to.blockId !== state.from.blockId) {
      this.#pendingChange = change;
      return;
    }
    const relevant = new Set<BlockId>();
    if (state.kind === "text") relevant.add(state.from.blockId);
    else for (const id of state.ids) relevant.add(id);
    if (change.blockIds.some((id) => relevant.has(id))) this.#pendingChange = change;
  }

  #rebase(): void {
    const change = this.#pendingChange;
    const pendingDeltas = this.#pendingDeltas;
    this.#pendingChange = null;
    this.#pendingDeltas = new Map();
    if (change === null) return;

    const state = this.#state;
    const crossBlock = state.kind === "text" && state.to !== null && state.to.blockId !== state.from.blockId;
    const facts: StructuralFacts = {
      deletedIds: new Set(change.blockIds.filter((id) => this.#doc.getBlock(id) === null)),
      linearization: crossBlock ? linearize(this.#doc) : [],
      textLength: (id) => this.#doc.getTextLength(id),
      isTextBlock: (id) => {
        const block = this.#doc.getBlock(id);
        return block !== null && BLOCK_REGISTRY[block.type].content;
      },
    };
    const next = rebaseSelection(state, pendingDeltas, facts);
    if (!selectionsEqual(state, next)) {
      this.#state = next;
      this.#emit();
    }
    this.#reconcileTracking();
  }

  /** Track exactly the blocks the text selection references (from + to). */
  #reconcileTracking(): void {
    const state = this.#state;
    const wanted: BlockId[] =
      state.kind === "text"
        ? [
            state.from.blockId,
            ...(state.to !== null && state.to.blockId !== state.from.blockId ? [state.to.blockId] : []),
          ]
        : [];
    for (const [blockId, unbind] of [...this.#trackers]) {
      if (!wanted.includes(blockId)) {
        unbind();
        this.#trackers.delete(blockId);
      }
    }
    for (const blockId of wanted) {
      if (this.#trackers.has(blockId)) continue;
      this.#trackers.set(
        blockId,
        trackBlockText(this.#doc.raw, blockId, (deltas) => {
          this.#pendingDeltas.set(blockId, deltas);
        })
      );
    }
  }
}

/** Validate a text point against the document; throws InvalidSelectionError. */
function validateTextPoint(doc: Doc, point: unknown, label: string): TextPoint {
  if (point === null || typeof point !== "object") throw new InvalidSelectionError(`${label} must be a text point.`);
  const { blockId, offset } = point as { blockId?: unknown; offset?: unknown };
  if (typeof blockId !== "string") throw new InvalidSelectionError(`${label}.blockId must be a string.`);
  const block = doc.getBlock(blockId);
  if (block === null) throw new InvalidSelectionError(`${label} references unknown block "${blockId}".`);
  if (!BLOCK_REGISTRY[block.type].content) {
    throw new InvalidSelectionError(`${label} block "${blockId}" (type "${block.type}") has no text content.`);
  }
  if (typeof offset !== "number" || !Number.isInteger(offset)) {
    throw new InvalidSelectionError(`${label}.offset must be an integer.`);
  }
  const length = doc.getTextLength(blockId);
  if (offset < 0 || offset > length) {
    throw new InvalidSelectionError(`${label}.offset ${offset} is outside [0, ${length}] of block "${blockId}".`);
  }
  return { blockId, offset };
}

/** Validate and normalize a selection into a stored (engine-filled) form. */
function normalizeSelection(doc: Doc, selection: Selection): Selection {
  if (typeof selection !== "object" || selection === null) {
    throw new InvalidSelectionError("Selection must be an object.");
  }
  const { kind } = selection;
  if (kind === "none") return { kind: "none" };

  if (kind === "text") {
    const from = validateTextPoint(doc, selection.from, "from");
    const to = selection.to === null ? null : validateTextPoint(doc, selection.to, "to");
    const blocks =
      to === null || to.blockId === from.blockId ? [from.blockId] : chainFor(doc, from.blockId, to.blockId);
    // A provided chain is validated against the computed one (no silent fix).
    if (selection.blocks !== undefined) {
      if (selection.blocks.length !== blocks.length || selection.blocks.some((id, i) => id !== blocks[i])) {
        throw new InvalidSelectionError(`Cross-block chain does not match the document order.`);
      }
    }
    const next: Selection = { kind: "text", from, to, blocks };
    if (typeof selection.reverse === "boolean") next.reverse = selection.reverse;
    return next;
  }

  if (kind === "blocks") {
    if (!Array.isArray(selection.ids) || selection.ids.length === 0) {
      throw new InvalidSelectionError("A blocks selection needs a non-empty ids list.");
    }
    for (const id of selection.ids) {
      if (typeof id !== "string" || doc.getBlock(id) === null) {
        throw new InvalidSelectionError(`A blocks selection references unknown block "${String(id)}".`);
      }
    }
    if (typeof selection.anchorId !== "string" || !selection.ids.includes(selection.anchorId)) {
      throw new InvalidSelectionError(`A blocks selection anchorId must be one of its ids.`);
    }
    return { kind: "blocks", ids: [...selection.ids], anchorId: selection.anchorId };
  }

  throw new InvalidSelectionError(`Unknown selection kind "${String(kind)}".`);
}

/** The DFS chain of a cross-block selection; throws when a block is unreachable. */
function chainFor(doc: Doc, fromId: BlockId, toId: BlockId): BlockId[] {
  const chain = chainBetween(linearize(doc), fromId, toId);
  if (chain === null) {
    throw new InvalidSelectionError(`Cross-block selection: block "${toId}" is not reachable from the root.`);
  }
  return chain;
}

function cloneSelection(state: Selection): Selection {
  if (state.kind === "none") return { kind: "none" };
  if (state.kind === "blocks") return { kind: "blocks", ids: [...state.ids], anchorId: state.anchorId };
  return {
    kind: "text",
    from: { blockId: state.from.blockId, offset: state.from.offset },
    to: state.to === null ? null : { blockId: state.to.blockId, offset: state.to.offset },
    blocks: [...(state.blocks ?? [])],
    ...(state.reverse !== undefined ? { reverse: state.reverse } : {}),
  };
}

/** Structural equality (drives the rebase emission: no-op changes emit nothing). */
function selectionsEqual(a: Selection, b: Selection): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "none") return true;
  if (a.kind === "blocks" && b.kind === "blocks") {
    return a.anchorId === b.anchorId && a.ids.length === b.ids.length && a.ids.every((id, i) => id === b.ids[i]);
  }
  if (a.kind === "text" && b.kind === "text") {
    if (a.from.blockId !== b.from.blockId || a.from.offset !== b.from.offset) return false;
    if ((a.to === null) !== (b.to === null)) return false;
    if (a.to !== null && b.to !== null && (a.to.blockId !== b.to.blockId || a.to.offset !== b.to.offset)) return false;
    const ba = a.blocks ?? [];
    const bb = b.blocks ?? [];
    return ba.length === bb.length && ba.every((id, i) => id === bb[i]) && a.reverse === b.reverse;
  }
  return false;
}

/** Create a per-view selection for a document (multiple independent views may coexist). */
function createSelection(doc: Doc): SelectionView {
  return new SelectionView(doc);
}

export { SelectionView, createSelection };
export type { Selection, TextPoint };
