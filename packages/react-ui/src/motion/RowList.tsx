/**
 * The motion editor's row list: the `Reorder.Group` + the flat rows, the
 * memo boundary that keeps framer's `ReorderContext` value (collected per
 * Group render, its fresh closures un-memoizable by the consumer) from
 * propagating into the rows on parent churn: a text-only change re-renders
 * nothing here (the rows' props stand), so the framer fibers and the
 * rows' context consumers stand as well.
 */
import { AnimatePresence, Reorder } from "framer-motion";

import { memo } from "react";

import type { BlockId } from "docblocks-core";

import type { FlatNode } from "../blocks";
import { RowItem } from "./RowItem";

interface RowListProps {
  order: BlockId[];
  nodesById: Map<BlockId, FlatNode>;
  layoutSlide: boolean;
  draggingKey: BlockId | null;
  previewIndent: number | null;
  animated: boolean;
  onReorder: (next: BlockId[]) => void;
  onDragStart: (id: BlockId) => void;
  onDragMove: (id: BlockId, event: PointerEvent | MouseEvent | TouchEvent) => void;
  onDragEnd: (id: BlockId, event: PointerEvent | MouseEvent | TouchEvent) => void;
}

const RowList = memo(function RowList({
  order,
  nodesById,
  layoutSlide,
  draggingKey,
  previewIndent,
  animated,
  onReorder,
  onDragStart,
  onDragMove,
  onDragEnd,
}: RowListProps) {
  return (
    <Reorder.Group
      as="div"
      data-slot="docblocks/rows"
      axis="y"
      values={order}
      onReorder={(next) => onReorder(next as BlockId[])}
    >
      <AnimatePresence initial={false} mode="sync">
        {order.map((id) => {
          const node = nodesById.get(id);
          if (node === undefined) return null;
          return (
            <RowItem
              key={id}
              node={node}
              layoutSlide={layoutSlide}
              isDragged={draggingKey === id}
              animated={animated}
              previewIndent={draggingKey === id ? previewIndent : null}
              onDragStart={() => onDragStart(id)}
              onDragEnd={(event) => onDragEnd(id, event)}
              onDragMove={(event) => onDragMove(id, event)}
            />
          );
        })}
      </AnimatePresence>
    </Reorder.Group>
  );
});

export { RowList };
