import * as Y from "yjs";

import type { Block, BlockId } from "@docblocks-core/schema";

import { findParent } from "./commands/blocks";
import { readBlock, readText } from "./read";

/**
 * Fine-grained reactivity: one emission per Yjs transaction (local or
 * remote). The observer is attached to the root Y.Map — this Yjs build
 * has no observeDeep on Y.Doc — so event paths are relative to it:
 * ["meta", ...] and ["blocks", blockId, ...].
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

interface Hub {
  /** Attached observer; null while detached. Kept stable for unobserveDeep. */
  observer: DeepObserver | null;
  changeHandlers: Set<ChangeHandler>;
  blockHandlers: Map<BlockId, Set<BlockHandler>>;
  textHandlers: Map<BlockId, Set<TextHandler>>;
}

const hubs = new WeakMap<Y.Doc, Hub>();

function getHub(ydoc: Y.Doc): Hub {
  let hub = hubs.get(ydoc);
  if (hub === undefined) {
    hub = { observer: null, changeHandlers: new Set(), blockHandlers: new Map(), textHandlers: new Map() };
    hubs.set(ydoc, hub);
  }
  return hub;
}

function getRoot(ydoc: Y.Doc): Y.Map<unknown> {
  const root = ydoc.getMap("root");
  if (!(root instanceof Y.Map)) {
    throw new Error("docblocks: broken Yjs layout (root map missing)");
  }
  return root;
}

/**
 * Assemble the Change of one transaction, or null when nothing user-visible
 * changed. `metaChanged` tracks the title only: the Yjs-only `updatedAt`
 * bookkeeping field is not part of the JSON and never counts.
 */
function buildChange(ydoc: Y.Doc, events: Y.YEvent<Y.AbstractType<unknown>>[]): Change | null {
  const blockIds = new Set<BlockId>();
  let metaChanged = false;

  for (const event of events) {
    const path = event.path;
    if (path[0] === "meta") {
      if (path.length > 1 && path[1] === "title") {
        metaChanged = true;
      } else if (path.length === 1 && event.keys.has("title")) {
        metaChanged = true;
      }
      continue;
    }
    if (path[0] !== "blocks") continue;

    if (path.length === 1) {
      // The blocks map itself: the affected ids live in the event keys.
      event.keys.forEach((_change, blockId) => {
        blockIds.add(blockId);
        // The parent's children list changed too.
        const parent = findParent(ydoc, blockId);
        if (parent !== null) blockIds.add(parent);
      });
      continue;
    }

    const blockId = path[1];
    if (typeof blockId === "string") blockIds.add(blockId);
  }

  if (blockIds.size === 0 && !metaChanged) return null;
  return { blockIds: [...blockIds], metaChanged };
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
  if (hub.observer !== null) return; // already attached
  hub.observer = (events) => {
    const change = buildChange(ydoc, events);
    if (change !== null) emitChange(ydoc, change);
  };
  getRoot(ydoc).observeDeep(hub.observer);
}

/** Detach the observer when the last subscription is gone. */
function release(ydoc: Y.Doc, hub: Hub): void {
  const empty = hub.changeHandlers.size === 0 && hub.blockHandlers.size === 0 && hub.textHandlers.size === 0;
  if (empty && hub.observer !== null) {
    getRoot(ydoc).unobserveDeep(hub.observer);
    hub.observer = null;
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
