/** The flat page's nested-content render: the collapse gate (while the
 * parent block is collapsed (view state) the segment is unmounted — the
 * other panes stand; the rows keep their indent in the data), the
 * container's nested slot (the derived segment inside a rendered-only
 * `docblocks/nested` wrapper (the CSS indent step), in reading order),
 * the list item's nested content (the flat model's sublist / nested
 * content: the same-kind items render as a nested list directly inside
 * the item (the marker nesting, no slot), the rest — a different-kind run
 * or a non-list block — in the item's nested slot). Hidden (unmounted)
 * while the item is collapsed (view state: the text re-syncs from the
 * store on the expand). The per-block renderer is passed as a prop (the
 * `renderBlock`): the nested content renders the blocks, and the block
 * renders the nested content — the explicit prop keeps the dependency
 * one-directional (nested-slot → list-run → no back-edge to the
 * per-block). */
import { useStore } from "zustand";

import type { ReactNode } from "react";

import type { BlockId } from "docblocks-core";

import { useEditorContext } from "../editor-provider";
import type { BlockRenderer } from "./ListRun";
import { GroupedNodes, ListRun, nestedSegments } from "./ListRun";
import type { FlatNode, ListKind } from "./flat";

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
function NestedSlot({ id, nodes, renderBlock }: { id: BlockId; nodes: FlatNode[]; renderBlock: BlockRenderer }) {
  return (
    <CollapsedGate id={id}>
      <div data-slot="docblocks/nested" className="pl-(--docblocks-nested-indent)">
        <GroupedNodes nodes={nodes} renderBlock={renderBlock} />
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
function ItemNested({
  id,
  nodes,
  ownKind,
  renderBlock,
}: {
  id: BlockId;
  nodes: FlatNode[];
  ownKind: ListKind;
  renderBlock: BlockRenderer;
}) {
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
            renderBlock={renderBlock}
          />
        ) : (
          <div key={`slot-${index}`} data-slot="docblocks/nested" className="pl-(--docblocks-nested-indent)">
            <GroupedNodes nodes={segment.nodes} renderBlock={renderBlock} />
          </div>
        )
      )}
    </CollapsedGate>
  );
}

export { CollapsedGate, ItemNested, NestedSlot };
