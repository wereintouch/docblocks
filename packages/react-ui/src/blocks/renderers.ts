import type { ReactNode } from "react";

import type { Block, BlockId, BlockType } from "docblocks-core";

/** The props a block renderer receives: the block id and its plain snapshot. */
interface BlockRendererProps {
  id: BlockId;
  block: Block;
}

/**
 * A consumer renderer for a block type; resolved in place of the built-in
 * renderer. Replacing a text-editable type swaps the whole block view,
 * including the contenteditable element and its editing affordance — a
 * renderer that needs editing drives the core commands through the hooks
 * (the consumer builds its own UI on top of them).
 *
 * A renderer is a plain render function, not a component: it is invoked
 * during the block view's render, so it must not call hooks itself —
 * return a component's output from a wrapper component if needed.
 */
type BlockRenderer = (props: BlockRendererProps) => ReactNode;

/**
 * Per-instance consumer renderers, keyed by block type. A type without an
 * entry keeps its built-in renderer; a type with neither renders the
 * placeholder (future block types keep working).
 */
type BlockRendererMap = Partial<Record<BlockType, BlockRenderer>>;

export type { BlockRenderer, BlockRendererMap, BlockRendererProps };
