/** The motion editor's flat row: a page block as a `Reorder.Item` (the
 *  gutter handle's drag trigger, the indent steps' padding, the
 *  enter/exit geometry, the position-only layout slide). */
import { Reorder, useDragControls } from "framer-motion";
import { useStore } from "zustand";

import { memo, useCallback, useRef } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

import { useEditorContext } from "../EditorProvider";
import { BlockNodeView } from "../blocks/BlockView";
import { useBlockContext } from "../blocks/block-context";
import { useBlock } from "../hooks";
import { Button } from "../shared/ui/Button";
import { cn } from "../shared/ui/cn";
import { GripVertical } from "../shared/ui/icons";
import { ANIMATE, ENTER, EXIT, TEXT_ROW_TYPES, TRANSITION } from "./models";
import type { RowItemProps } from "./models";

/**
 * One flat row: a page block as a `Reorder.Item`. The drag is pure framer
 * (the row's `dragControls`, started from the gutter handle's pointerdown
 * — the handle is the only drag trigger, so a press without movement
 * stays the plain block selection). Every page row is a drag source: the
 * text types' built-in renderer renders the handle inside its own
 * wrapper, every other row carries the row-level handle. The row's left
 * padding is the `indent`'s per-level steps (a list item's extra step is
 * its marker gutter — the base view's list padding), so the nesting is
 * the data, not a wrapper.
 */
const RowItem = memo(
  function RowItem({
    node,
    layoutSlide,
    isDragged,
    animated,
    previewIndent,
    onDragStart,
    onDragEnd,
    onDragMove,
  }: RowItemProps) {
    const dragControls = useDragControls();
    const rowRef = useRef<HTMLDivElement | null>(null);
    const { doc, store, selection: selectionRef } = useEditorContext();
    const blockContext = useBlockContext();
    const isList = node.kind !== undefined;
    const block = useBlock(node.id);
    const selected = useStore(
      store,
      (state) => state.selection.kind === "blocks" && state.selection.ids.includes(node.id)
    );
    // The row-level gutter handle: the non-text page rows' drag trigger
    // (the text rows' handle stands inside their own wrapper). The gutter
    // column follows the indent steps only — a list row's marker zone stands
    // in the row's content, so every row of one indent shares the columns.
    const needsRowGutter = block !== undefined && !TEXT_ROW_TYPES.has(block.type);

    /** The gutter handle's pointerdown starts this row's framer drag. */
    const onRowPointerDown = useCallback(
      (event: ReactPointerEvent<HTMLDivElement>) => {
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (target === null) return;
        if (target.closest('[data-slot="docblocks/gutter"]') === null) return;
        dragControls.start(event);
      },
      [dragControls]
    );

    /** Gutter click: a blocks selection on this row's block (Shift extends from the anchor). */
    const onGutterClick = useCallback(
      (event: ReactMouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        const view = selectionRef.view;
        if (view === null) return;
        const id = node.id;
        const current = view.get();
        if (event.shiftKey && current.kind === "blocks") {
          const siblings = doc.getChildren(blockContext.parentId);
          const anchorIndex = siblings.indexOf(current.anchorId);
          const hereIndex = siblings.indexOf(id);
          // Same parent only; a cross-parent range is a v1.1 feature.
          if (anchorIndex !== -1 && hereIndex !== -1) {
            const [low, high] = anchorIndex <= hereIndex ? [anchorIndex, hereIndex] : [hereIndex, anchorIndex];
            view.set({ kind: "blocks", ids: siblings.slice(low, high + 1), anchorId: current.anchorId });
          } else {
            view.set({ kind: "blocks", ids: [id], anchorId: id });
          }
        } else {
          view.set({ kind: "blocks", ids: [id], anchorId: id });
        }
        // The row takes the focus: the selection keys (Delete/Backspace/
        // Escape) bubble to the editor root's handler.
        rowRef.current?.focus();
      },
      [blockContext, doc, node.id, selectionRef]
    );

    /** Keep a mousedown on the handle from moving the text caret. */
    const onHandleMouseDown = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
    }, []);

    return (
      <Reorder.Item
        as="div"
        ref={rowRef}
        data-slot="docblocks/row"
        data-selected={selected ? "true" : undefined}
        value={node.id}
        tabIndex={0}
        initial={animated ? ENTER : false}
        animate={ANIMATE}
        exit={EXIT}
        // Per-value: the enter/exit geometry keeps the snappy slide; the
        // layout animation runs the 0.18 s slide only while the slide is
        // armed (a drag in flight, a structural settle) and 0 otherwise —
        // an in-place content change reflows instantly (a zero-duration
        // projection, not a visible slide).
        transition={{
          opacity: TRANSITION,
          height: TRANSITION,
          marginBottom: TRANSITION,
          layout: layoutSlide ? TRANSITION : { duration: 0 },
        }}
        // Position-only, always armed: a size projection would scale a row
        // while its content height settles (the text squashes or
        // stretches).
        layout="position"
        // Framer's own row-wide drag is disarmed: the gutter handle owns
        // the pointer (a row-wide drag would fight the text selection and
        // the cross-drag gestures).
        dragListener={false}
        dragControls={dragControls}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDrag={onDragMove}
        onPointerDown={onRowPointerDown}
        className={cn(needsRowGutter && "group", "outline-none")}
        style={{
          position: "relative",
          // The indent steps, plus the list row's marker zone (the row's
          // first character, right before the text). The in-flight seam
          // candidate (the drag's live preview) replaces the row's own
          // indent for the padding only — the doc stays as it is.
          paddingLeft: `calc(${previewIndent ?? node.indent} * var(--docblocks-nested-indent) + ${isList ? "var(--docblocks-marker-width)" : "0px"})`,
          ...(isDragged ? { zIndex: 30 } : undefined),
        }}
      >
        {needsRowGutter && (
          <Button
            type="button"
            data-slot="docblocks/gutter"
            aria-label="Select block"
            variant="ghost"
            size="icon"
            onClick={onGutterClick}
            onMouseDown={onHandleMouseDown}
            // The left edge stands at the row's left step (the indent steps
            // only — the marker zone keeps the row content clear), the grip
            // offset from it as the text rows' own handle (centered on the
            // row's first line).
            className={cn(
              "absolute top-[calc((var(--docblocks-line-box-height)-var(--docblocks-gutter-size))/2)]",
              "cursor-pointer rounded-full opacity-0 group-hover:opacity-100",
              "text-(--docblocks-gutter-color)",
              "size-5",
              selected && "opacity-100"
            )}
            style={{
              left: `calc(${previewIndent ?? node.indent} * var(--docblocks-nested-indent) + var(--docblocks-gutter-left))`,
            }}
          >
            <GripVertical />
          </Button>
        )}
        <BlockNodeView node={node} flat />
      </Reorder.Item>
    );
  },
  (prev, next) =>
    prev.node === next.node &&
    prev.layoutSlide === next.layoutSlide &&
    prev.isDragged === next.isDragged &&
    prev.previewIndent === next.previewIndent
);

export { RowItem };
