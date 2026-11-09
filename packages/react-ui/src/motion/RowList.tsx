/**
 * The motion page view (the Editor's page rendering): the `Reorder.Group`
 * + the flat rows, the memo boundary that keeps framer's `ReorderContext`
 * value (collected per Group render, its fresh closures un-memoizable by
 * the consumer) from propagating into the rows on parent churn: a
 * text-only change re-renders nothing here (the rows' props stand), so
 * the framer fibers and the rows' context consumers stand as well.
 *
 * The Editor's page view IS this row layer (the former `MotionEditor`'s
 * merge — the `./motion` subpath and the `MotionEditor` export stand
 * removed; framer-motion is a required peer). The page view renders the
 * FLAT page sequence: every page block is its own row (a framer
 * `Reorder.Item`), the nesting is the block's `indent` attr (the row's
 * left padding steps per level; a list item's marker is a rendered label
 * per row — the row is not in a list element, so the native `ol`/`ul`
 * marker is absent). The top-level rows render through `AnimatePresence`
 * (`sync` — the rows stay in the layout flow while they enter/exit): an
 * inserted block fades in as its height grows, a removed one fades out
 * as it collapses (the mirror). Rows that mount while the editor is still
 * loading (the mount and the sync load — before the first text input in
 * the editor) stand up instantly (`initial={false}`): the load is not an
 * insert. The siblings' position slides on a reorder (a drag or a remote
 * move); the slide is position-only (a size projection would scale an
 * entry while its content height settles and distort the text). The
 * layout projection is armed on every row at all times — a row whose
 * layout feature toggles with the slide state (unmounting between
 * renders) does not slide reliably when a live reorder commits — and the
 * slide is gated by the per-value layout transition duration instead:
 * the 0.18 s slide runs only while a drag or a structural settle is in
 * flight, 0 otherwise, so an in-place height change (typing, a line
 * break, a remote edit) reflows instantly.
 *
 * Drag-reorder: pure framer `Reorder` (the standard `Reorder.Group`/
 * `Reorder.Item` pattern — the local order state, the live reorder, the
 * commit on release). Every page block is a reorder target; a block whose
 * row renders the gutter handle (the text types) is a drag source — the
 * handle is the only drag trigger (framer's own `drag` is disarmed on the
 * row and started from the handle's pointerdown through the row's
 * `dragControls`; a press without movement stays the plain block
 * selection). One drag issues one range move of the dragged block's
 * derived subtree (the block and its deeper followers — a range
 * operation on the sequence: one transact, one undo step, one wire
 * update); the commit index is the pre-move index (a drop that ends at
 * the same position issues no command, a move-to-end target is the
 * sequence's length). A vertical drop is a reorder only — the level
 * change is the Tab/Shift+Tab gesture (one `updateBlock({ indent })`).
 *
 * Known accepted edges: a remote doc update mid-drag re-derives the row
 * list; the in-flight drag may visually restart, and a release whose
 * derived final order is stale against the store is dropped (no commit —
 * the local order resyncs to the store). A peer that deletes the dragged
 * row mid-drag unmounts it: the session state is released in the render
 * phase — the release does not depend on framer delivering onDragEnd for
 * the unmounted row — and the local order resyncs to the store. Framer's
 * own reorder detection on a long downward drag can cascade the virtual
 * index toward the bottom; the release commits the order framer actually
 * produced (the stale-drop guard stands the backstop).
 *
 * The implementation stands in the segment files (`RowItem`, `hooks`,
 * `models`, `utils`; the seam/commit math in `reorder/`).
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
  const handleReorder = (next: unknown) => onReorder(next as BlockId[]);
  const rowDragStart = (id: BlockId) => () => onDragStart(id);
  const rowDragEnd = (id: BlockId) => (event: Parameters<RowListProps["onDragEnd"]>[1]) => onDragEnd(id, event);
  const rowDragMove = (id: BlockId) => (event: Parameters<RowListProps["onDragMove"]>[1]) => onDragMove(id, event);

  return (
    <Reorder.Group as="div" data-slot="docblocks/rows" axis="y" values={order} onReorder={handleReorder}>
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
              onDragStart={rowDragStart(id)}
              onDragEnd={rowDragEnd(id)}
              onDragMove={rowDragMove(id)}
            />
          );
        })}
      </AnimatePresence>
    </Reorder.Group>
  );
});

export { RowList };
