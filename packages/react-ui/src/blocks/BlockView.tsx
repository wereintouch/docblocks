import { useStore } from "zustand";

import { Fragment, memo, useMemo, useRef } from "react";
import type { ReactNode } from "react";

import type { Block, BlockId, ListItemAttrs } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import { useBlock } from "../hooks";
import { cn } from "../shared/ui/cn";
import { CodeHeader } from "./CodeHeader";
import { DatabaseBlock } from "./DatabaseBlock";
import { EmbedBlock } from "./EmbedBlock";
import { FrameBlock } from "./FrameBlock";
import { ImageBlock } from "./ImageBlock";
import { PlaceholderBlock } from "./PlaceholderBlock";
import { SurfaceBlock } from "./SurfaceBlock";
import { SyncEmbedBlock } from "./SyncEmbedBlock";
import { TableBlock } from "./table";
import { TextBlock } from "./TextBlock";
import { deriveFlat, markerCycle } from "./flat";
import type { FlatNode } from "./flat";

const HEADING_TAGS = { 1: "h1", 2: "h2", 3: "h3", 4: "h4", 5: "h5", 6: "h6" } as const;

type ListKind = ListItemAttrs["list"];

/**
 * One list run: consecutive list items of one kind at one indent level,
 * rendered as a native `<ul>`/`<ol>` (the base view keeps the derived list
 * DOM: a sublist is a nested list inside the item wrapper, and the native
 * numbering continues across it — `1. [sub] 2.`). `data-depth` carries the
 * marker's cycle index (1|2|3, not the raw level): the nesting depth is
 * unbounded and CSS cannot modulo it, so the renderer cycles it (the
 * marker style cycles per level — disc / circle / square and decimal /
 * lower-alpha / lower-roman; the task list has no marker, the checkbox
 * stands in for it). The list carries the block spacing only at the
 * sequence's top level (a nested list's spacing stands on its list item).
 */
function ListRun({ nodes, kind, indent }: { nodes: FlatNode[]; kind: ListKind; indent: number }) {
  const Tag: "ul" | "ol" = kind === "number" ? "ol" : "ul";
  const cycle = markerCycle(indent);
  const bulletMarkers = ["list-disc", "list-[circle]", "list-[square]"] as const;
  const numberMarkers = ["list-decimal", "list-[lower-alpha]", "list-[lower-roman]"] as const;
  const markerClass =
    kind === "task" ? "list-none" : kind === "bullet" ? bulletMarkers[cycle - 1] : numberMarkers[cycle - 1];
  return (
    <Tag
      data-slot="docblocks/list"
      data-list={kind}
      data-depth={cycle}
      className={cn(
        "pl-(--docblocks-list-padding-left)",
        indent === 0 ? "my-(--docblocks-block-spacing)" : "my-0",
        markerClass
      )}
    >
      {nodes.map((node) => (
        <FlatBlockView key={node.id} node={node} />
      ))}
    </Tag>
  );
}

/** One segment of nested content: a stretch of blocks rendered inside a container (the slot or the item). */
type NestedSegment =
  { kind: "list"; list: ListKind; indent: number; nodes: FlatNode[] } | { kind: "single"; nodes: FlatNode[] };

/**
 * Partition a block's direct derived children into render segments (the
 * flat model's nested content): a maximal run of list items of ONE kind
 * forms a list run (a native list). For a list item, only the items of
 * its OWN kind are the marker nesting (they render as a nested list
 * directly inside the item); a different-kind run — or a text / non-text
 * block — is the item's nested content (the attach rule: a different-kind
 * item is content, not a sublist), collected into a rendered-only `nested`
 * slot. A non-list container renders every run as a list and every
 * non-list block as a single.
 */
function nestedSegments(nodes: FlatNode[], ownKind: ListKind | undefined): NestedSegment[] {
  const segments: NestedSegment[] = [];
  let i = 0;
  while (i < nodes.length) {
    const node = nodes[i]!;
    if (node.kind !== undefined) {
      const runKind = node.kind;
      let j = i + 1;
      while (j < nodes.length && nodes[j]!.kind === runKind) j += 1;
      // For a list item, a different-kind run is its nested content (the
      // attach rule: marker nesting is the own kind only).
      if (ownKind !== undefined && runKind !== ownKind) {
        segments.push({ kind: "single", nodes: nodes.slice(i, j) });
      } else {
        segments.push({ kind: "list", list: runKind, indent: node.indent, nodes: nodes.slice(i, j) });
      }
      i = j;
      continue;
    }
    let j = i + 1;
    while (j < nodes.length && nodes[j]!.kind === undefined) j += 1;
    segments.push({ kind: "single", nodes: nodes.slice(i, j) });
    i = j;
  }
  return segments;
}

/** A non-list block's (or a slot's) children in reading order: list runs as lists, the rest as single blocks. */
function GroupedNodes({ nodes }: { nodes: FlatNode[] }) {
  const segments = nestedSegments(nodes, undefined);
  return (
    <>
      {segments.flatMap((segment) =>
        segment.kind === "list"
          ? [
              <ListRun
                key={`list-${segment.nodes[0]!.id}`}
                nodes={segment.nodes}
                kind={segment.list}
                indent={segment.indent}
              />,
            ]
          : segment.nodes.map((node) => <FlatBlockView key={node.id} node={node} />)
      )}
    </>
  );
}

/**
 * The derived nested content's collapse gate: while the parent block is
 * collapsed (view state) the segment is unmounted (the other panes stand;
 * the rows keep their indent in the data).
 */
function CollapsedGate({ id, children }: { id: BlockId; children: ReactNode }) {
  const { store } = useEditorContext();
  const collapsed = useStore(store, (state) => state.collapsedIds.includes(id));
  return collapsed ? null : <>{children}</>;
}

/**
 * A container's nested content: the derived segment inside a rendered-only
 * `docblocks/nested` wrapper (the CSS indent step), in reading order (a
 * list run groups into its list, the rest stands as single blocks); hidden
 * while the parent block is collapsed.
 */
function NestedSlot({ id, nodes }: { id: BlockId; nodes: FlatNode[] }) {
  return (
    <CollapsedGate id={id}>
      <div data-slot="docblocks/nested" className="pl-(--docblocks-nested-indent)">
        <GroupedNodes nodes={nodes} />
      </div>
    </CollapsedGate>
  );
}

/**
 * A list item's nested content (the flat model's sublist / nested content):
 * the same-kind items render as a nested list directly inside the item
 * (the marker nesting, no slot), the rest — a different-kind run or a
 * non-list block — in the item's nested slot. Hidden (unmounted) while the
 * item is collapsed (view state: the text re-syncs from the store on the
 * expand).
 */
function ItemNested({ id, nodes, ownKind }: { id: BlockId; nodes: FlatNode[]; ownKind: ListKind }) {
  const segments = nestedSegments(nodes, ownKind);
  return (
    <CollapsedGate id={id}>
      {segments.map((segment, index) =>
        segment.kind === "list" ? (
          <ListRun
            key={`list-${segment.nodes[0]!.id}`}
            nodes={segment.nodes}
            kind={segment.list}
            indent={segment.indent}
          />
        ) : (
          <div key={`slot-${index}`} data-slot="docblocks/nested" className="pl-(--docblocks-nested-indent)">
            <GroupedNodes nodes={segment.nodes} />
          </div>
        )
      )}
    </CollapsedGate>
  );
}

/**
 * The built-in dispatch of one block (no consumer renderer): the text
 * types take the derived nested content through the wrapper (a list item
 * nests its sublist inside itself, the rest in its nested slot) — the
 * sequence views only; a flat (motion) row renders the block alone, its
 * derived nesting standing as the sequence's own rows; the non-text types
 * render standalone (their derived content stands after the block,
 * threaded by the sequence layer).
 */
function dispatchBuiltIn(
  id: BlockId,
  block: Block,
  nested: ReactNode,
  collapsible: boolean,
  flat: boolean,
  number: number | undefined
): ReactNode {
  switch (block.type) {
    case "paragraph":
      return (
        <TextBlock
          id={id}
          block={block}
          tag="div"
          nested={nested}
          collapsible={collapsible}
          flat={flat}
          number={number}
        />
      );
    case "quote":
      return (
        <TextBlock
          id={id}
          block={block}
          tag="div"
          nested={nested}
          collapsible={collapsible}
          flat={flat}
          number={number}
        />
      );
    case "heading":
      return (
        <TextBlock
          id={id}
          block={block}
          tag={HEADING_TAGS[block.attrs.level]}
          nested={nested}
          collapsible={collapsible}
          flat={flat}
          number={number}
        />
      );
    case "callout":
      return (
        <TextBlock
          id={id}
          block={block}
          tag="aside"
          nested={nested}
          collapsible={collapsible}
          flat={flat}
          number={number}
        />
      );
    case "list-item":
      return (
        <TextBlock
          id={id}
          block={block}
          tag="li"
          nested={nested}
          collapsible={collapsible}
          flat={flat}
          number={number}
        />
      );
    case "code":
      return (
        <TextBlock
          id={id}
          block={block}
          tag="pre"
          header={<CodeHeader id={id} block={block} />}
          nested={nested}
          collapsible={collapsible}
          flat={flat}
          number={number}
        />
      );
    case "divider":
      return (
        <hr
          data-slot="docblocks/divider"
          data-block-type="divider"
          data-block-id={id}
          className="
            m-(--docblocks-divider-margin) border-0 border-t-(length:--docblocks-divider-border-width)
            border-t-(--docblocks-divider-border-color)
          "
        />
      );
    case "image":
      return <ImageBlock id={id} block={block} />;
    case "database":
      return <DatabaseBlock id={id} block={block} />;
    case "embed":
      return <EmbedBlock id={id} block={block} />;
    case "sync-embed":
      return <SyncEmbedBlock id={id} block={block} />;
    case "table":
      return <TableBlock id={id} block={block} />;
    case "surface":
      return <SurfaceBlock id={id} block={block} />;
    case "frame":
      // The frame renders through FrameBlock in every context: inside a
      // surface (the box + the nested provider) and as a provider entry
      // root (its own nested provider renders the content). A stray one
      // at the page root (lenient data) renders its content in place
      // (the container posture, like a stray table).
      return <FrameBlock id={id} />;
    case "shape":
    case "connector":
    case "canvas-text":
      // The canvas element types render ONLY inside a surface (the
      // CanvasItem dispatch). A stray one at the page root (lenient data
      // — the registry forbids it) falls to the placeholder (the
      // unknown-kind posture).
      return <PlaceholderBlock type={block.type} />;
    default:
      // table-row / table-cell render inside TableBlock; unknown types
      // fall through to the placeholder.
      return <PlaceholderBlock type={block.type} />;
  }
}

/**
 * The block body + the derived nested content, per view. The text
 * renderers thread the content into the wrapper (a list item nests its
 * sublist inside itself, the rest in its nested slot); a consumer
 * renderer or a non-text built-in renderer renders it as a nested slot
 * AFTER the block view (the renderer does not thread it — the content is
 * never dropped). `flat` (the motion view's flat row): the `number` item's
 * marker stands as a rendered label (the row is not in a list element —
 * the native `ol`/`ul` marker is absent; the base view numbers the `ol`
 * natively), and the derived nesting is NOT threaded into the wrapper —
 * the flat sequence's rows own it (a nested block renders exactly once,
 * as its own row).
 *
 * Memoized on the node's identity: the derivation interns the node
 * objects, so an unchanged node (indent, run position, children) keeps its
 * reference across re-derivations, and a change to a sibling never
 * re-renders this node — the store subscription inside (the block
 * snapshot) re-renders it on its own text change. A node whose block is
 * missing (removed by a peer) renders nothing.
 */
const BlockNodeView = memo(
  function BlockNodeView({ node, flat = false }: { node: FlatNode; flat?: boolean }) {
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
    const nested: ReactNode = hasChildren ? (
      isListItem ? (
        <ItemNested id={node.id} nodes={node.children} ownKind={block.attrs.list} />
      ) : (
        <NestedSlot id={node.id} nodes={node.children} />
      )
    ) : undefined;
    const custom = renderers[block.type];
    const builtInText =
      block.type === "paragraph" ||
      block.type === "quote" ||
      block.type === "heading" ||
      block.type === "callout" ||
      block.type === "code" ||
      isListItem;
    if (custom !== undefined) {
      const view = custom({ id: node.id, block });
      if (!hasChildren) return view;
      return (
        <Fragment>
          {view}
          <NestedSlot id={node.id} nodes={node.children} />
        </Fragment>
      );
    }
    const view = dispatchBuiltIn(node.id, block, nested, collapsible, flat, node.number);
    // The text renderers thread the content into the wrapper; the non-text
    // built-in renderers stand it after the block.
    if (!hasChildren || builtInText) return view;
    return (
      <Fragment>
        {view}
        <NestedSlot id={node.id} nodes={node.children} />
      </Fragment>
    );
  },
  // The node identity is the memo: the derivation interns node objects, so
  // an unchanged node (indent, run position, children) keeps its reference
  // across re-derivations. The children's data stands in the node's own
  // (interned) references.
  (prev, next) => prev.node === next.node && prev.flat === next.flat
);

/**
 * One derived node of a flat sequence, rendered in the base view.
 */
const FlatBlockView = memo(
  function FlatBlockView({ node }: { node: FlatNode }) {
    return <BlockNodeView node={node} />;
  },
  (prev, next) => prev.node === next.node
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
  return <GroupedNodes nodes={derivation.nodes} />;
}

/**
 * Renders one block by id, standalone (no derived nesting): the canvas
 * element types inside a surface, a provider entry root that is a
 * structural block (a table, a frame), or any block outside a flat
 * sequence context (a surface's z-order). The block snapshot is
 * store-driven by reference, so a change to a sibling never re-renders
 * this component. A block removed by a peer renders nothing.
 */
const BlockView = memo(function BlockView({ id }: { id: BlockId }) {
  const block = useBlock(id);
  if (block === undefined) return null;
  return dispatchBuiltIn(id, block, undefined, false, false, undefined);
});

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

export { BlockGroups, BlockNodeView, BlockView, childrenSlot };
