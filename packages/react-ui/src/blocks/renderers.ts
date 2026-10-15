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
 * including the wrapper, the contenteditable element, and its editing
 * affordance — a renderer that needs editing drives the core commands
 * through the hooks (the consumer builds its own UI on top of them).
 *
 * The built-in text renderers read the per-block context (the page
 * context — the root, a table cell, or a frame — and the flat page
 * sequence) for the keyboard gestures; a consumer renderer does not read
 * it — the context is part of the built-in rendering, not of the renderer
 * contract. Nesting is a derived notion (the flat page model: a block's
 * `indent` attr relative to its preceding block, not a data field), so a
 * replaced block does not receive its derived nested content — the
 * sequence rendering stands a block's deeper followers as a nested slot
 * AFTER the replaced view (the content is never dropped); a renderer that
 * wants to render them itself drives the doc through the hooks.
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
