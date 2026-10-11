import * as Y from "yjs";

import type { Block, BlockId } from "@docblocks-core/schema";

import { findParent } from "./commands/blocks";
import { rootBlockIdOf } from "./layout";
import { readBlock, readText } from "./read";

/**
 * Fine-grained reactivity: one emission per Yjs transaction (local or
 * remote). This Yjs build has no observeDeep on Y.Doc, so one observer per
 * registered top-level type (meta, blocks, rootOrder) merges its events
 * into a per-transaction change; the doc's afterTransaction hook — which
 * fires after all type observers ran — emits the merged change once.
 *
 * Emission order within a transaction: onChange listeners first, then
 * per-block onBlock / observeText.
 */

/** A document change: which block snapshots changed and whether the title changed. */
interface Change {
  /**
   * Every block whose snapshot changed (own fields or its children list).
   * Added and removed ids are included, and the parent of an added or
   * removed block is included too (its children changed).
   */
  blockIds: BlockId[];
  /** True when the document title changed. */
  metaChanged: boolean;
}

type ChangeHandler = (change: Change) => void;
type BlockHandler = (block: Block) => void;
type TextHandler = (text: string) => void;
type DeepObserver = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => void;

/** The merged change of the in-flight transaction; null between transactions. */
interface PendingChange {
  blockIds: Set<BlockId>;
  metaChanged: boolean;
}

/** The attached observers, kept stable for unobserve*; null while detached. */
interface Observers {
  meta: DeepObserver;
  blocks: DeepObserver;
  rootOrder: () => void;
  afterTransaction: () => void;
}

interface Hub {
  observers: Observers | null;
  pending: PendingChange | null;
  changeHandlers: Set<ChangeHandler>;
  blockHandlers: Map<BlockId, Set<BlockHandler>>;
  textHandlers: Map<BlockId, Set<TextHandler>>;
}

const hubs = new WeakMap<Y.Doc, Hub>();

function getHub(ydoc: Y.Doc): Hub {
  let hub = hubs.get(ydoc);
  if (hub === undefined) {
    hub = {
      observers: null,
      pending: null,
      changeHandlers: new Set(),
      blockHandlers: new Map(),
      textHandlers: new Map(),
    };
    hubs.set(ydoc, hub);
  }
  return hub;
}

/** The in-flight transaction's merged change (created on the first type event). */
function pendingOf(hub: Hub): PendingChange {
  if (hub.pending === null) hub.pending = { blockIds: new Set(), metaChanged: false };
  return hub.pending;
}

/** The meta observer: the title only; the Yjs-only `updatedAt` never counts. */
function observeMeta(hub: Hub, events: Y.YEvent<Y.AbstractType<unknown>>[]): void {
  const pending = pendingOf(hub);
  for (const event of events) {
    const path = event.path;
    // Paths are relative to the meta map: [] is the map itself, [title] the Y.Text.
    if (path.length === 0) {
      if (event.keys.has("title")) pending.metaChanged = true;
    } else if (path[0] === "title") {
      pending.metaChanged = true;
    }
  }
}

/** The blocks observer: paths are relative to the blocks map ([blockId, ...]). */
function observeBlocks(ydoc: Y.Doc, hub: Hub, events: Y.YEvent<Y.AbstractType<unknown>>[]): void {
  const pending = pendingOf(hub);
  for (const event of events) {
    const path = event.path;
    if (path.length === 0) {
      // The blocks map itself: the affected ids live in the event keys.
      event.keys.forEach((_change, blockId) => {
        pending.blockIds.add(blockId);
        // The parent's children list changed too.
        const parent = findParent(ydoc, blockId);
        if (parent !== null) pending.blockIds.add(parent);
      });
      continue;
    }
    const blockId = path[0];
    if (typeof blockId === "string") pending.blockIds.add(blockId);
  }
}

/** The rootOrder observer: any event is a change of the root block's children. */
function observeRootOrder(ydoc: Y.Doc, hub: Hub): void {
  pendingOf(hub).blockIds.add(rootBlockIdOf(ydoc));
}

/** Emit the in-flight transaction's merged change, if anything user-visible changed. */
function emitPending(ydoc: Y.Doc, hub: Hub): void {
  const pending = hub.pending;
  hub.pending = null;
  if (pending === null || (pending.blockIds.size === 0 && !pending.metaChanged)) return;
  emitChange(ydoc, { blockIds: [...pending.blockIds], metaChanged: pending.metaChanged });
}

function emitChange(ydoc: Y.Doc, change: Change): void {
  const hub = getHub(ydoc);

  for (const handler of [...hub.changeHandlers]) handler(change);

  for (const blockId of change.blockIds) {
    const blockHandlers = hub.blockHandlers.get(blockId);
    if (blockHandlers !== undefined && blockHandlers.size > 0) {
      const block = readBlock(ydoc, blockId);
      // A removed block emits nothing: removals are visible via onChange.blockIds.
      if (block !== null) {
        for (const handler of [...blockHandlers]) handler(block);
      }
    }
    const textHandlers = hub.textHandlers.get(blockId);
    if (textHandlers !== undefined && textHandlers.size > 0) {
      // Fires on any field change of the block; a removed block reports "".
      const text = readText(ydoc, blockId);
      for (const handler of [...textHandlers]) handler(text);
    }
  }
}

function attach(ydoc: Y.Doc, hub: Hub): void {
  if (hub.observers !== null) return; // already attached
  hub.observers = {
    meta: (events) => observeMeta(hub, events),
    blocks: (events) => observeBlocks(ydoc, hub, events),
    rootOrder: () => observeRootOrder(ydoc, hub),
    afterTransaction: () => emitPending(ydoc, hub),
  };
  ydoc.getMap("meta").observeDeep(hub.observers.meta);
  ydoc.getMap("blocks").observeDeep(hub.observers.blocks);
  ydoc.getArray("rootOrder").observe(hub.observers.rootOrder);
  ydoc.on("afterTransaction", hub.observers.afterTransaction);
}

/** Detach the observers when the last subscription is gone. */
function release(ydoc: Y.Doc, hub: Hub): void {
  const empty = hub.changeHandlers.size === 0 && hub.blockHandlers.size === 0 && hub.textHandlers.size === 0;
  const observers = hub.observers;
  if (empty && observers !== null) {
    ydoc.getMap("meta").unobserveDeep(observers.meta);
    ydoc.getMap("blocks").unobserveDeep(observers.blocks);
    ydoc.getArray("rootOrder").unobserve(observers.rootOrder);
    ydoc.off("afterTransaction", observers.afterTransaction);
    hub.observers = null;
  }
}

/** Subscribe to document changes (one emission per transaction). Returns unsubscribe. */
function onChange(ydoc: Y.Doc, handler: ChangeHandler): () => void {
  const hub = getHub(ydoc);
  hub.changeHandlers.add(handler);
  attach(ydoc, hub);
  return () => {
    hub.changeHandlers.delete(handler);
    release(ydoc, hub);
  };
}

/** Subscribe to the fresh snapshot of one block. Returns unsubscribe. */
function onBlock(ydoc: Y.Doc, blockId: BlockId, handler: BlockHandler): () => void {
  const hub = getHub(ydoc);
  let handlers = hub.blockHandlers.get(blockId);
  if (handlers === undefined) {
    handlers = new Set();
    hub.blockHandlers.set(blockId, handlers);
  }
  handlers.add(handler);
  attach(ydoc, hub);
  return () => {
    handlers.delete(handler);
    if (handlers.size === 0) hub.blockHandlers.delete(blockId);
    release(ydoc, hub);
  };
}

/** Subscribe to the flattened text of one block. Returns unsubscribe. */
function observeText(ydoc: Y.Doc, blockId: BlockId, handler: TextHandler): () => void {
  const hub = getHub(ydoc);
  let handlers = hub.textHandlers.get(blockId);
  if (handlers === undefined) {
    handlers = new Set();
    hub.textHandlers.set(blockId, handlers);
  }
  handlers.add(handler);
  attach(ydoc, hub);
  return () => {
    handlers.delete(handler);
    if (handlers.size === 0) hub.textHandlers.delete(blockId);
    release(ydoc, hub);
  };
}

export { onChange, onBlock, observeText };
export type { BlockHandler, Change, ChangeHandler, TextHandler };
