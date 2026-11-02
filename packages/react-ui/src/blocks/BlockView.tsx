/** The flat page's per-block render: the block body + the derived nested
 * content, per view. The text renderers thread the content into the
 * wrapper (a list item nests its sublist inside itself, the rest in its
 * nested slot); a consumer renderer or a non-text built-in renderer
 * renders it as a nested slot AFTER the block view (the renderer does not
 * thread it — the content is never dropped). `flat` (the motion view's
 * flat row): the `number` item's marker stands as a rendered label (the
 * row is not in a list element — the native `ol`/`ul` marker is absent;
 * the base view numbers the `ol` natively), and the derived nesting is
 * NOT threaded into the wrapper — the flat sequence's rows own it (a
 * nested block renders exactly once, as its own row).
 *
 * The per-block renderer is threaded as a prop (the `renderBlock`): the
 * block renders the nested content (the list run, the nested slot), and
 * the nested content renders the block — the explicit prop keeps the
 * dependency one-directional (no back-edge to the per-block).
 *
 * The per-block render error boundary stands over the dispatch: a
 * synchronous throw of a block's renderer (the anomalous data, the
 * consumer renderer) is contained to the block — the placeholder stand
 * replaces the failed render, the rest of the editor stands. The dispatch
 * renders in a child component (the `BlockBody`) below the boundary: a
 * boundary never contains its own render's throw. */
import { useStore } from "zustand";

import { Fragment, memo, useMemo, useRef } from "react";
import type { ReactNode } from "react";

import type { BlockId } from "docblocks-core";

import { useEditorContext } from "../editor-provider";
import { useBlock } from "../hooks";
import type { BlockRendererMap } from "./renderers";
import { BlockErrorBoundary } from "./BlockErrorBoundary";
import type { FlatBlockRenderer } from "./ListRun";
import { GroupedNodes } from "./ListRun";
import { ItemNested, NestedSlot } from "./NestedSlot";
import { dispatchBuiltIn } from "./block-dispatch";
import { deriveFlat } from "./flat";
import type { FlatNode } from "./flat";

/**
 * The block body's renderer dispatch, a child of the render error
 * boundary: the dispatch (the consumer renderer's call, the built-in
 * dispatch) throws during this component's render, so the boundary above
 * it contains the throw.
 */
function BlockBody({
  node,
  block,
  nested,
  collapsible,
  flat,
  renderers,
}: {
  node: FlatNode;
  block: NonNullable<ReturnType<typeof useBlock>>;
  nested: ReactNode;
  collapsible: boolean;
  flat: boolean;
  renderers: BlockRendererMap;
}) {
  const custom = renderers[block.type];
  if (custom !== undefined) return custom({ id: node.id, block });
  return dispatchBuiltIn(node.id, block, nested, collapsible, flat, node.number);
}

/**
 * The block body + the derived nested content, per view.
 *
 * Memoized on the node's identity: the derivation interns the node
 * objects, so an unchanged node (indent, run position, children) keeps its
 * reference across re-derivations, and a change to a sibling never
 * re-renders this node — the store subscription inside (the block
 * snapshot) re-renders it on its own text change. A node whose block is
 * missing (removed by a peer) renders nothing.
 */
const BlockNodeView = memo(
  function BlockNodeView({
    node,
    flat = false,
    renderBlock,
  }: {
    node: FlatNode;
    flat?: boolean;
    renderBlock: FlatBlockRenderer;
  }) {
    const { renderers } = useEditorContext();
    const block = useBlock(node.id);
    if (block === undefined) return null;
    // A flat (motion) row renders the block alone: its derived nesting
    // stands as the sequence's own rows, not inside the wrapper (threading
    // it in would render the nested blocks twice — once per row, once in
    // the parent's slot).
    const hasChildren = !flat && node.children.length > 0;
    const isListItem = block.type === "list-item";
    // The collapse toggle stands for any block with a derived segment,
    // flat or not (the flat rows' segment stands as the sequence's own
    // rows — the toggle hides them, it does not thread them in).
    const collapsible = node.children.length > 0;
    const builtInText =
      block.type === "paragraph" ||
      block.type === "quote" ||
      block.type === "heading" ||
      block.type === "callout" ||
      block.type === "code" ||
      isListItem;
    const isCustom = renderers[block.type] !== undefined;
    // The nested content threaded into the wrapper (the list item's sublist
    // inside itself, the text container's slot) — the built-in text
    // renderers only (a consumer renderer never threads it); the rest stands
    // after the block (the consumer renderer, the non-text built-in).
    const threaded: ReactNode = hasChildren && !isCustom ? (
      isListItem ? (
        <ItemNested id={node.id} nodes={node.children} ownKind={block.attrs.list} renderBlock={renderBlock} />
      ) : (
        <NestedSlot id={node.id} nodes={node.children} renderBlock={renderBlock} />
      )
    ) : undefined;
    const trailing: ReactNode = hasChildren && (isCustom || !builtInText) ? (
      <NestedSlot id={node.id} nodes={node.children} renderBlock={renderBlock} />
    ) : undefined;
    return (
      <BlockErrorBoundary version={block} type={block.type}>
        <BlockBody
          node={node}
          block={block}
          nested={threaded}
          collapsible={collapsible}
          flat={flat}
          renderers={renderers}
        />
        {trailing}
      </BlockErrorBoundary>
    );
  },
  // The node identity is the memo: the derivation interns node objects, so
  // an unchanged node (indent, run position, children) keeps its reference
  // across re-derivations. The children's data stands in the node's own
  // (interned) references.
  (prev, next) => prev.node === next.node && prev.flat === next.flat && prev.renderBlock === next.renderBlock
);

/**
 * One derived node of a flat sequence, rendered in the base view.
 */
const FlatBlockView: FlatBlockRenderer = memo(
  function FlatBlockView({ node, renderBlock }: { node: FlatNode; renderBlock: FlatBlockRenderer }) {
    return <BlockNodeView node={node} renderBlock={renderBlock} />;
  },
  (prev, next) => prev.node === next.node && prev.renderBlock === next.renderBlock
);

/**
 * A flat page sequence in reading order (the base view): the sequence is
 * derived per render (the store stays a flat map projection) — the top
 * level renders list runs as native lists and the rest as single blocks,
 * every block's nesting stands in its derived children (a list item's
 * sublist, a text container's nested slot).
 */
function BlockGroups({ ids }: { ids: BlockId[] }) {
  const { store } = useEditorContext();
  const blocks = useStore(store, (state) => state.blocks);
  // The interning cache: the previous derivation's byId stands while the
  // sequence's data is unchanged (the memo is keyed on the node identity).
  const prevRef = useRef<Map<string, FlatNode> | null>(null);
  const derivation = useMemo(() => {
    const result = deriveFlat(ids, blocks, prevRef.current ?? undefined);
    prevRef.current = result.byId;
    return result;
  }, [ids, blocks]);
  return <GroupedNodes nodes={derivation.nodes} renderBlock={FlatBlockView} />;
}

/**
 * Renders one block by id, standalone (no derived nesting): the canvas
 * element types inside a surface, a provider entry root that is a
 * structural block (a table, a frame), or any block outside a flat
 * sequence context (a surface's z-order). The block snapshot is
 * store-driven by reference, so a change to a sibling never re-renders
 * this component. A block removed by a peer renders nothing. The boundary
 * stands over the dispatch (the `StandaloneBody` child) for the same
 * reason as the sequence view.
 */
const BlockView = memo(function BlockView({ id }: { id: BlockId }) {
  const block = useBlock(id);
  if (block === undefined) return null;
  return (
    <BlockErrorBoundary version={block} type={block.type}>
      <StandaloneBody id={id} block={block} />
    </BlockErrorBoundary>
  );
});

/** The standalone block's dispatch (the child of the boundary above). */
function StandaloneBody({ id, block }: { id: BlockId; block: NonNullable<ReturnType<typeof useBlock>> }) {
  return dispatchBuiltIn(id, block, undefined, false, false, undefined);
}

/**
 * The LEGACY nested-content reader: page blocks no longer carry
 * `children` (the flat page model — the nesting is the sequence's
 * `indent` attr, and `fromJSON` / `loadDoc` normalize the legacy form
 * eagerly, so a live document never carries it). The derived nested
 * content is a SEQUENCE concern (it stands as the following blocks,
 * rendered by the sequence layer); this reader always resolves to
 * nothing and stands for the `./mermaid` subpath's fallthrough.
 */
function childrenSlot(_id: BlockId, children: BlockId[] | undefined): ReactNode {
  void _id;
  if (children === undefined || children.length === 0) return undefined;
  // A legacy `children` field on a live snapshot (unreachable through the
  // normalized load path): render nothing — the sequence rendering owns
  // the nesting.
  return undefined;
}

export { BlockGroups, BlockNodeView, BlockView, childrenSlot, FlatBlockView };
