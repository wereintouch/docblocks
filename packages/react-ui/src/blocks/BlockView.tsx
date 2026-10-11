import { useStore } from "zustand";

import { memo, useMemo } from "react";

import type { Block, BlockId, ListItemAttrs, ListItemBlock } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import { useBlock } from "../hooks";
import { EmbedBlock } from "./EmbedBlock";
import { ImageBlock } from "./ImageBlock";
import { PlaceholderBlock } from "./PlaceholderBlock";
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

/** One list: consecutive list items of the same kind. */
function ListGroup({ tag, list, ids }: { tag: "ul" | "ol"; list: ListKind; ids: BlockId[] }) {
  const Tag = tag;
  return (
    <Tag data-slot="docblocks/list" data-list={list}>
      {ids.map((childId) => (
        <BlockView key={childId} id={childId} />
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
const BlockGroups = memo(function BlockGroups({ ids }: { ids: BlockId[] }) {
  const { store } = useEditorContext();
  const blocks = useStore(store, (state) => state.blocks);
  const groups = useMemo(() => groupChildren(ids, blocks), [ids, blocks]);
  return (
    <>
      {groups.map((group) =>
        group.kind === "single" ? (
          <BlockView key={group.id} id={group.id} />
        ) : (
          <ListGroup key={`list-${group.ids[0]}`} tag={group.tag} list={group.list} ids={group.ids} />
        )
      )}
    </>
  );
});

/**
 * The nested list items of a list item: rendered inside the item's
 * wrapper, after the inner editable, with their own block context (the
 * item is their parent).
 */
const ListItemChildren = memo(function ListItemChildren({ id, block }: { id: BlockId; block: ListItemBlock }) {
  const children = block.children ?? EMPTY_IDS;
  const contextValue = useBlockContextValue(id, children);
  if (children.length === 0) return null;
  return (
    <BlockContext.Provider value={contextValue}>
      <BlockGroups ids={children} />
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
const BlockView = memo(function BlockView({ id }: { id: BlockId }) {
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
      return <TextBlock id={id} block={block} tag="li" nested={<ListItemChildren id={id} block={block} />} />;
    case "code":
      return <TextBlock id={id} block={block} tag="pre" />;
    case "latex":
      return <TextBlock id={id} block={block} tag="div" />;
    case "divider":
      return <hr data-slot="docblocks/divider" data-block-type="divider" data-block-id={id} />;
    case "image":
      return <ImageBlock id={id} block={block} />;
    case "embed":
      return <EmbedBlock id={id} block={block} />;
    case "table":
      return <TableBlock id={id} block={block} />;
    default:
      // table-row / table-cell render inside TableBlock; unknown types
      // fall through to the placeholder.
      return <PlaceholderBlock type={block.type} />;
  }
});

export { BlockGroups, BlockView, groupChildren };
