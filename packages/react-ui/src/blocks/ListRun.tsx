/** The flat page's list render: one list run (consecutive list items of one
 * kind at one indent level, rendered as a native `<ul>`/`<ol>` — the base
 * view keeps the derived list DOM: a sublist is a nested list inside the
 * item wrapper, and the native numbering continues across it — `1. [sub]
 * 2.`). `data-depth` carries the marker's cycle index (1|2|3, not the raw
 * level): the nesting depth is unbounded and CSS cannot modulo it, so the
 * renderer cycles it (the marker style cycles per level — disc / circle /
 * square and decimal / lower-alpha / lower-roman; the task list has no
 * marker, the checkbox stands in for it). The list carries the block
 * spacing only at the sequence's top level (a nested list's spacing stands
 * on its list item). The per-block renderer is passed as a prop (the
 * `renderBlock`): the list renders the blocks, and the block renders the
 * nested list — the explicit prop keeps the dependency one-directional
 * (list-run → no back-edge to the per-block). */
import type { ComponentType } from "react";

import { cn } from "../shared/ui/cn";
import { markerCycle } from "./flat";
import type { FlatNode, ListKind } from "./flat";

/** The per-block renderer the list runs render (the per-block wrapper, the
 * `renderBlock` threaded recursively so the nested content renders the
 * per-block without a back-edge import). */
type FlatBlockRenderer = ComponentType<{ node: FlatNode; renderBlock: FlatBlockRenderer }>;

/** One segment of nested content: a stretch of blocks rendered inside a container (the slot or the item). */
type NestedSegment =
  { kind: "list"; list: ListKind; indent: number; nodes: FlatNode[] } | { kind: "single"; nodes: FlatNode[] };

/**
 * One list run: consecutive list items of one kind at one indent level,
 * rendered as a native `<ul>`/`<ol>`.
 */
function ListRun({
  nodes,
  kind,
  indent,
  renderBlock,
}: {
  nodes: FlatNode[];
  kind: ListKind;
  indent: number;
  renderBlock: FlatBlockRenderer;
}) {
  const Tag: "ul" | "ol" = kind === "number" ? "ol" : "ul";
  const cycle = markerCycle(indent);
  const bulletMarkers = ["list-disc", "list-[circle]", "list-[square]"] as const;
  const numberMarkers = ["list-decimal", "list-[lower-alpha]", "list-[lower-roman]"] as const;
  const markerClass =
    kind === "task" ? "list-none" : kind === "bullet" ? bulletMarkers[cycle - 1] : numberMarkers[cycle - 1];
  const RenderBlock = renderBlock;
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
        <RenderBlock key={node.id} node={node} renderBlock={renderBlock} />
      ))}
    </Tag>
  );
}

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
function GroupedNodes({ nodes, renderBlock }: { nodes: FlatNode[]; renderBlock: FlatBlockRenderer }) {
  const segments = nestedSegments(nodes, undefined);
  const RenderBlock = renderBlock;
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
                renderBlock={renderBlock}
              />,
            ]
          : segment.nodes.map((node) => <RenderBlock key={node.id} node={node} renderBlock={renderBlock} />)
      )}
    </>
  );
}

export { GroupedNodes, ListRun, nestedSegments };
export type { NestedSegment };

export type { FlatBlockRenderer };
