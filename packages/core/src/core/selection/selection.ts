/** The per-view selection: the SelectionView class + the createSelection
 *  factory. The state (the Selection / TextPoint types) stands in models; the
 *  validation/normalization helpers stand in utils. */
import type { Transaction } from "yjs";

import { BLOCK_REGISTRY } from "@docblocks-core/schema";
import type { BlockId } from "@docblocks-core/schema";

import type { Doc } from "../doc";
import { DestroyedViewError } from "../errors";
import { onChange } from "../events";
import type { Change } from "../events";
import { undoManagerOf } from "../history";
import { localOriginOf } from "../layout";
import { trackBlockText } from "./deltas";
import type { TextDelta } from "./deltas";
import type { Selection, StackItemEventLike } from "./models";
import { linearize, rebaseSelection } from "./rebase";
import type { StructuralFacts } from "./rebase";
import { cloneSelection, normalizeSelection, selectionsEqual } from "./utils";

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
    // Cross-block: the chain is a reading-order segment (a contiguous
    // sequence segment for page content; a structural descent for cells
    // and frames) — a change inside or above it (e.g. under a cell or a
    // frame containing an endpoint) may reshape it, so rebase on any
    // change (the no-op check suppresses emission).
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

/** Create a per-view selection for a document (multiple independent views may coexist). */
function createSelection(doc: Doc): SelectionView {
  return new SelectionView(doc);
}

export { SelectionView, createSelection };
