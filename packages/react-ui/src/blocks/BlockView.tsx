import { useStore } from "zustand";

import { memo, useMemo } from "react";

import type { Block, BlockId, ListItemAttrs, ListItemBlock } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import { useBlock } from "../hooks";
import { DatabaseBlock } from "./DatabaseBlock";
import { EmbedBlock } from "./EmbedBlock";
import { FrameBlock } from "./FrameBlock";
import { ImageBlock } from "./ImageBlock";
import { PlaceholderBlock } from "./PlaceholderBlock";
import { SurfaceBlock } from "./SurfaceBlock";
import { SyncEmbedBlock } from "./SyncEmbedBlock";
import { TableBlock } from "./TableBlock";
import { TextBlock } from "./TextBlock";
import { BlockContext, useBlockContextValue } from "./block-context";

const HEADING_TAGS = { 1: "h1", 2: "h2", 3: "h3", 4: "h4", 5: "h5", 6: "h6" } as const;

type ListKind = ListItemAttrs["list"];

const EMPTY_IDS: BlockId[] = [];

type ChildGroup = { kind: "single"; id: BlockId } | { kind: "list"; tag: "ul" | "ol"; list: ListKind; ids: BlockId[] };

/** Groups consecutive list items of the same list kind into one list. */
function groupChildren(ids: BlockId[], blocks: Record<BlockId, Block>): ChildGroup[] {
  const groups: ChildGroup[] = [];
  for (const id of ids) {
    const block = blocks[id];
    const kind = block !== undefined && block.type === "list-item" ? block.attrs.list : undefined;
    if (kind !== undefined) {
      const last = groups[groups.length - 1];
      if (last !== undefined && last.kind === "list" && last.list === kind) {
        last.ids.push(id);
        continue;
      }
      groups.push({ kind: "list", tag: kind === "number" ? "ol" : "ul", list: kind, ids: [id] });
      continue;
    }
    groups.push({ kind: "single", id });
  }
  return groups;
}

/**
 * One list: consecutive list items of the same kind. `data-depth` carries
 * the marker's cycle index (1|2|3, not the raw level): the nesting depth is
 * unbounded and CSS cannot modulo it, so the renderer cycles it.
 */
function ListGroup({ tag, list, ids, depth }: { tag: "ul" | "ol"; list: ListKind; ids: BlockId[]; depth: number }) {
  const Tag = tag;
  return (
    <Tag data-slot="docblocks/list" data-list={list} data-depth={((depth - 1) % 3) + 1}>
      {ids.map((childId) => (
        <BlockView key={childId} id={childId} depth={depth} />
      ))}
    </Tag>
  );
}

/**
 * One container's children in reading order: list items grouped into
 * lists, the rest as single blocks. The block context for the children is
 * provided by the container's own renderer (the editor root, a table row,
 * a cell, or the parent list item).
 */
const BlockGroups = memo(function BlockGroups({ ids, depth = 1 }: { ids: BlockId[]; depth?: number }) {
  const { store } = useEditorContext();
  const blocks = useStore(store, (state) => state.blocks);
  const groups = useMemo(() => groupChildren(ids, blocks), [ids, blocks]);
  return (
    <>
      {groups.map((group) =>
        group.kind === "single" ? (
          <BlockView key={group.id} id={group.id} depth={depth} />
        ) : (
          <ListGroup key={`list-${group.ids[0]}`} tag={group.tag} list={group.list} ids={group.ids} depth={depth} />
        )
      )}
    </>
  );
});

/**
 * The nested list items of a list item: rendered inside the item's
 * wrapper, after the inner editable, with their own block context (the
 * item is their parent). Hidden (unmounted) while the item is collapsed
 * (view state: the text re-syncs from the store on the expand).
 */
const ListItemChildren = memo(function ListItemChildren({
  id,
  block,
  depth,
}: {
  id: BlockId;
  block: ListItemBlock;
  depth: number;
}) {
  const { store } = useEditorContext();
  const collapsed = useStore(store, (state) => state.collapsedIds.includes(id));
  const children = block.children ?? EMPTY_IDS;
  const contextValue = useBlockContextValue(id, children);
  if (children.length === 0 || collapsed) return null;
  return (
    <BlockContext.Provider value={contextValue}>
      <BlockGroups ids={children} depth={depth + 1} />
    </BlockContext.Provider>
  );
});

/**
 * Renders one block by id. Memoized on the stable id: the block snapshot
 * is store-driven by reference, so a change to a sibling block never
 * re-renders this component. A block removed by a peer renders nothing.
 *
 * Renderer resolution (per instance): a consumer renderer for the type,
 * then the built-in renderer, then the placeholder (unknown and future
 * types keep working).
 */
const BlockView = memo(function BlockView({ id, depth = 1 }: { id: BlockId; depth?: number }) {
  const { renderers } = useEditorContext();
  const block = useBlock(id);
  if (block === undefined) return null;

  const custom = renderers[block.type];
  if (custom !== undefined) return custom({ id, block });

  switch (block.type) {
    case "paragraph":
      return <TextBlock id={id} block={block} tag="div" />;
    case "heading":
      return <TextBlock id={id} block={block} tag={HEADING_TAGS[block.attrs.level]} />;
    case "callout":
      return <TextBlock id={id} block={block} tag="aside" />;
    case "list-item":
      return (
        <TextBlock id={id} block={block} tag="li" nested={<ListItemChildren id={id} block={block} depth={depth} />} />
      );
    case "code":
      return <TextBlock id={id} block={block} tag="pre" />;
    case "latex":
      return <TextBlock id={id} block={block} tag="div" />;
    case "divider":
      return <hr data-slot="docblocks/divider" data-block-type="divider" data-block-id={id} />;
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
});

export { BlockGroups, BlockView, groupChildren };
