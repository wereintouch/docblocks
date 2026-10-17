import { createContext, useContext, useMemo } from "react";

import type { BlockId, BlockType } from "docblocks-core";

/**
 * Per-block structural context: the parent block id and the parent's
 * children in reading order.
 *
 * Provided by the container renderers (the editor root, the table
 * rows/cells, the nested list rendering). The built-in text renderers
 * read it for the keyboard gestures; a consumer's custom renderer
 * replaces the whole block view and does not read it (it drives the core
 * commands through the hooks).
 *
 * `siblings` is the render-time snapshot; gestures that mutate the doc
 * re-read `doc.getChildren(parentId)` at event time — the context carries
 * the container identity, the doc carries the live order.
 */
interface BlockContextValue {
  /** The parent block id (the document id for top-level blocks). */
  parentId: BlockId;
  /** The parent's type (absent when the provider does not know it). */
  parentType?: BlockType;
  /** The parent's children in reading order, including the block itself. */
  siblings: BlockId[];
}

const BlockContext = createContext<BlockContextValue | null>(null);

/**
 * A referentially stable block context value: a block snapshot change
 * (e.g. a text edit of the container) replaces the `siblings` array with
 * a content-equal one — without the content key the context value would
 * churn and re-render every consumer of the subtree.
 */
function useBlockContextValue(parentId: BlockId, siblings: BlockId[], parentType?: BlockType): BlockContextValue {
  const key = siblings.join("\u0000");
  // The key is content-equal whenever the siblings list is unchanged, so
  // the closure's captured siblings stay valid for a cached value.
  return useMemo(() => ({ parentId, parentType, siblings }), [parentId, parentType, key]);
}

/** Read the block context; throws outside a block context provider. */
function useBlockContext(): BlockContextValue {
  const context = useContext(BlockContext);
  if (context === null) throw new Error("useBlockContext must be used inside a block context provider.");
  return context;
}

export { BlockContext, useBlockContext, useBlockContextValue };
export type { BlockContextValue };
