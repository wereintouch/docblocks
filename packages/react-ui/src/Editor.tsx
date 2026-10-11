import { useStore } from "zustand";

import { useMemo } from "react";

import type { Block, BlockId, ListItemAttrs } from "docblocks-core";

import { useEditorContext } from "./EditorProvider";
import { BlockView } from "./blocks/BlockView";

type ListKind = ListItemAttrs["list"];

type ChildGroup = { kind: "single"; id: BlockId } | { kind: "list"; tag: "ul" | "ol"; list: ListKind; ids: BlockId[] };

/** Group consecutive list-items with the same list kind into one list. */
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

function ListGroup({ tag, list, ids }: { tag: "ul" | "ol"; list: ListKind; ids: BlockId[] }) {
  const Tag = tag;
  return (
    <Tag data-list={list}>
      {ids.map((id) => (
        <BlockView key={id} id={id} />
      ))}
    </Tag>
  );
}

/** Renders the document's top-level blocks in reading order. */
function Editor() {
  const { store } = useEditorContext();
  const rootChildren = useStore(store, (state) => state.rootChildren);
  const blocks = useStore(store, (state) => state.blocks);

  const groups = useMemo(() => groupChildren(rootChildren, blocks), [rootChildren, blocks]);

  return (
    <div data-block-type="root">
      {groups.map((group) =>
        group.kind === "single" ? (
          <BlockView key={group.id} id={group.id} />
        ) : (
          <ListGroup key={`list-${group.ids[0]}`} tag={group.tag} list={group.list} ids={group.ids} />
        )
      )}
    </div>
  );
}

export { Editor };
