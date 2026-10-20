/**
 * docblocks-react-ui/motion — the animated editor view.
 *
 * framer-motion is an optional peer dependency and is imported only from
 * this subpath: the base entry (`docblocks-react-ui`) never imports it,
 * so a consumer without the package ships zero extra weight.
 *
 * `MotionEditor` is a drop-in replacement for the base `Editor` under the
 * same `EditorProvider` — the same root element (the focus/keyboard
 * scope), the same block rendering and editing wiring, and the same
 * presence overlay. The page view renders the FLAT page sequence: every
 * page block is its own row (a framer `Reorder.Item`), the
 * nesting is the block's `indent` attr (the row's left padding steps per
 * level; a list item's marker is a rendered label per row — the row is
 * not in a list element, so the native `ol`/`ul` marker is absent). The
 * top-level rows render through `AnimatePresence` (`sync` — the rows
 * stay in the layout flow while they enter/exit): an inserted block
 * fades in as its height grows, a removed one fades out as it collapses
 * (the mirror). Rows that mount while the editor is still loading (the
 * mount and the sync load — before the first text input in the editor)
 * stand up instantly (`initial={false}`): the load is not an insert.
 * The siblings' position slides on a reorder (a drag or a
 * remote move). The slide is position-only — a size projection would
 * scale an entry while its content height settles and distort the text. The layout projection is
 * armed on every row at all times — a row whose layout feature toggles
 * with the slide state (unmounting between renders) does not slide
 * reliably when a live reorder commits — and the slide is gated by the
 * per-value layout transition duration instead: the 0.18 s slide runs
 * only while a drag or a structural settle is in flight, 0 otherwise, so
 * an in-place height change (typing, a line break, a remote edit)
 * reflows instantly.
 *
 * Drag-reorder: pure framer `Reorder` (the standard
 * `Reorder.Group`/`Reorder.Item` pattern — the local order state, the
 * live reorder, the commit on release). Every page block is a reorder
 * target; a block whose row renders the gutter handle (the text types) is
 * a drag source — the handle is the only drag trigger (framer's own
 * `drag` is disarmed on the row and started from the handle's pointerdown
 * through the row's `dragControls`; a press without movement stays the
 * plain block selection). One drag issues one range move of the dragged
 * block's derived subtree (the block and its deeper followers — a range
 * operation on the sequence: one transact, one undo step, one
 * wire update); the commit index is the pre-move index (a drop that ends at
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
 * own reorder detection
 * on a long downward drag can cascade the virtual index toward the
 * bottom (accepted as the experimental base — if it proves unacceptable
 * in e2e, the commit's stale-drop guard is the backstop: the release
 * commits the order framer actually produced).
 */
import { AnimatePresence, Reorder, useDragControls } from "framer-motion";
import { useStore } from "zustand";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

import { BLOCK_REGISTRY, type BlockId } from "docblocks-core";

import type { EditorView } from "../Editor";
import { useEditorContext } from "../EditorProvider";
import { BlockNodeView } from "../blocks/BlockView";
import { CanvasView } from "../blocks/CanvasView";
import { BlockContext, useBlockContext } from "../blocks/block-context";
import { deriveFlat, entrySequenceParent, visibleRows } from "../blocks/flat";
import type { FlatNode } from "../blocks/flat";
import { FormatPaletteContext } from "../blocks/format-palette-context";
import { segmentRange } from "../editing/block-commands";
import { FORMAT_PALETTE, useFormatToolbar } from "../editing/format-toolbar";
import { SlashMenuContext, useSlashMenu } from "../editing/slash";
import { useEditing } from "../editing/useEditing";
import { useBlock } from "../hooks";
import { PresenceCaretOverlay } from "../presence/presence-caret";
import { Button } from "../shared/ui/Button";
import { Card } from "../shared/ui/Card";
import { cn } from "../shared/ui/cn";
import { GripVertical } from "../shared/ui/icons";
import { type DropRow, clampTailSeatCrossing, commitFlatDrag, dropCandidateIndent, sameIds } from "./reorder";

/**
 * The enter/exit geometry of a row. The spacing margin collapses on exit
 * so a leaving row does not keep its gap.
 */
const ENTER = { opacity: 0, height: 0 } as const;
const ANIMATE = { opacity: 1, height: "auto" } as const;
const EXIT = { opacity: 0, height: 0, marginBottom: 0 } as const;

/**
 * The enter/exit and layout-slide transition (one snappy ease). The
 * between-rows reflow while a drag runs (the rows slide into each crossed
 * slot) runs the layout arm of this transition (gated per-value: 0 while
 * the slide is disarmed).
 */
const TRANSITION = { duration: 0.18, ease: "easeOut" } as const;

/**
 * The drag's pointer Y (the seam measurement's input): the pointer/mouse
 * event's clientY, or the last changed touch's (the touch release event
 * carries no coordinate of its own). Null when the event stands no
 * usable coordinate (the measurement is stale — the caller keeps the
 * preview or skips the commit).
 */
function pointerYOf(event: PointerEvent | MouseEvent | TouchEvent): number | null {
  if (event instanceof TouchEvent) {
    const touch = event.changedTouches[event.changedTouches.length - 1];
    return touch === null || touch === undefined ? null : touch.clientY;
  }
  return event.clientY;
}

/** How long the layout slide stays armed after a structural render (the slide itself runs 0.18s). */
const SLIDE_SETTLE_MS = 400;

/**
 * The tail seat's id for the drag's preview clamp (or undefined when the
 * clamp does not stand): the seat is the full-doc root's trailing row
 * (the guaranteed trailing text paragraph), and it stands for a dragged
 * row whose derived segment is NON-TEXT-terminated (a text-terminated
 * segment lands its text tail last — the doc's tail invariant stands and
 * the crossing is clean — no clamp, the end landing is the preview's
 * stand). The seat's own drag stands unclamped too (it is a real block).
 */
function tailSeatId(
  doc: import("docblocks-core").Doc,
  rootBlockId: string,
  draggedId: string,
  trailingRowId: string | undefined
): string | undefined {
  if (trailingRowId === undefined || draggedId === trailingRowId) return undefined;
  const segment = segmentRange(doc, rootBlockId, draggedId);
  if (segment === null) return undefined;
  const lastId = doc.getChildren(rootBlockId)[segment.end - 1];
  if (lastId === undefined) return undefined;
  const lastBlock = doc.getBlock(lastId);
  if (lastBlock === null) return undefined;
  if (BLOCK_REGISTRY[lastBlock.type].content) return undefined;
  // The seat is a TOP-LEVEL trailing block only: the commit's seat (the
  // segment lands just before it) would re-attach a nested trailing block
  // to the childless non-text segment, so the commit stands the end
  // landing there — the preview stands it too (the clamp's stand must
  // match the commit's).
  const trailingBlock = doc.getBlock(trailingRowId);
  if (trailingBlock === null || trailingRowId === lastId) return undefined;
  if (!BLOCK_REGISTRY[trailingBlock.type].content) return undefined;
  const trailingAttrs =
    "attrs" in trailingBlock ? (trailingBlock.attrs as Record<string, unknown> | undefined) : undefined;
  const trailingIndent = typeof trailingAttrs?.indent === "number" ? trailingAttrs.indent : 0;
  return trailingIndent === 0 ? trailingRowId : undefined;
}

/**
 * The drag affordance: the handle shows the grab cursor in this view
 * only — the rule is scoped to the root attribute below, so the base
 * editor keeps the stylesheet's plain pointer cursor.
 */
const HANDLE_GRAB_STYLE = '[data-docblocks-motion] [data-slot="docblocks/gutter"] { cursor: grab; }';

/**
 * The grip typing flag: the editor root holds `data-docblocks-typing` from
 * the first text keypress in its own content until the first pointer move
 * or the focus leaving the editor — the stylesheet's unlayered rule hides
 * the hover grip while the attribute stands (a selected block's grip is a
 * selection indicator and stays visible). The attribute is imperative: a
 * React state would re-render every row per keypress.
 */
function useTypingFlag(rootRef: { current: HTMLDivElement | null }) {
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const setTyping = (typing: boolean) => {
      if (typing) root.setAttribute("data-docblocks-typing", "");
      else root.removeAttribute("data-docblocks-typing");
    };
    const onKeydown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target === null || target.closest('[data-slot="docblocks/editor"]') !== root) return;
      if (target.closest('[data-slot="docblocks/block-content"]') === null) return;
      // A text keypress only: a control key (Tab, the arrows, the mod
      // hotkeys) is a gesture, not typing.
      if (event.key.length !== 1 || event.key === "\t" || event.metaKey || event.ctrlKey || event.altKey) return;
      setTyping(true);
    };
    const onPointerMove = () => setTyping(false);
    const onFocusOut = () => {
      const active = document.activeElement;
      if (active instanceof Node && root.contains(active)) return;
      setTyping(false);
    };
    document.addEventListener("keydown", onKeydown);
    window.addEventListener("pointermove", onPointerMove);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("keydown", onKeydown);
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, [rootRef]);
}

/**
 * The enter-animation gate: the latch stands on the first text input in
 * this editor (a printable keydown or an input event in the editor's
 * contenteditable) — rows that mount before it (the mount and the sync
 * load) stand up instantly (`initial={false}`: the animate
 * values, no height-growth animation); a row that appears after it is an
 * insert in progress and runs the enter animation. The gate never clears
 * (a load window is a start window, not a session state).
 */
function useEnterAnimationGate(rootRef: { current: HTMLDivElement | null }) {
  const gateRef = useRef(false);
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const inThisEditorText = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target === null) return false;
      if (target.closest('[data-slot="docblocks/editor"]') !== root) return false;
      return target.closest('[data-slot="docblocks/block-content"]') !== null;
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;
      if (!inThisEditorText(event)) return;
      gateRef.current = true;
    };
    const onInput = (event: Event) => {
      if (!inThisEditorText(event)) return;
      gateRef.current = true;
    };
    document.addEventListener("keydown", onKeydown);
    document.addEventListener("input", onInput);
    return () => {
      document.removeEventListener("keydown", onKeydown);
      document.removeEventListener("input", onInput);
    };
  }, [rootRef]);
  return gateRef;
}

interface RowItemProps {
  node: FlatNode;
  /** The position-only layout slide armed (a drag in flight, a structural settle): selects the rows' layout transition. */
  layoutSlide: boolean;
  /** This row is the one being dragged (the zIndex keeps it above the sliding siblings). */
  isDragged: boolean;
  /**
   * The in-flight seam candidate (the dragged row only, the drag's live
   * preview): the row's left padding stands at the candidate's steps
   * instead of the row's own indent — a pure preview (the doc, the wire,
   * and the store are untouched); the drop's commit applies the same
   * value, so the preview stands where the drop lands.
   */
  previewIndent: number | null;
  /**
   * The enter-animation gate is open (the editor saw a text input): this
   * row's mount runs the enter animation (ENTER). A row that mounts while
   * the gate stands closed (the mount, the sync load) renders its animate
   * values at once (initial={false} — no height-growth animation).
   */
  animated: boolean;
  /** The row's drag session start (from its gutter handle's pointerdown). */
  onDragStart: () => void;
  /** The row's release: the flat-range commit for this block. */
  onDragEnd: (event: PointerEvent | MouseEvent | TouchEvent) => void;
  /** The drag's live seam-candidate update (the preview's source). */
  onDragMove: (event: PointerEvent | MouseEvent | TouchEvent) => void;
}

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
/** The text types whose built-in renderer renders the row's gutter handle (the row-level one stands for every other type). */
const TEXT_ROW_TYPES = new Set(["paragraph", "quote", "heading", "callout", "list-item", "code", "latex"]);

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

function MotionEditor({
  view = "page",
  formatPalette = FORMAT_PALETTE,
}: {
  view?: EditorView;
  formatPalette?: readonly string[];
}) {
  const { doc, store, rootBlockId } = useEditorContext();
  const rootChildren = useStore(store, (state) => state.rootChildren);
  const blocks = useStore(store, (state) => state.blocks);
  const collapsedIds = useStore(store, (state) => state.collapsedIds);
  // The gestures' command parent: the entry root's sequence container (a
  // subtree entry root is a page block — structurally childless, so its
  // commands target the container of its sequence, not itself).
  const rootContext = useMemo(
    () => ({ parentId: entrySequenceParent(doc, rootBlockId), siblings: rootChildren }),
    [doc, rootBlockId, rootChildren]
  );
  const { rootRef, onKeyDown, onCopy, onPointerDown: onCrossDragPointerDown } = useEditing();
  const slash = useSlashMenu(rootRef);
  const format = useFormatToolbar(rootRef, formatPalette);
  useTypingFlag(rootRef);
  const enterGate = useEnterAnimationGate(rootRef);

  // The flat page sequence, derived per render (the store stays a flat map
  // projection). The interning cache: the previous derivation's byId
  // stands while the sequence's data is unchanged (the row memo is keyed
  // on the node identity).
  const prevRef = useRef<Map<string, FlatNode> | null>(null);
  const derivation = useMemo(() => {
    const result = deriveFlat(rootChildren, blocks, prevRef.current ?? undefined);
    prevRef.current = result.byId;
    return result;
  }, [rootChildren, blocks]);
  // The visible rows: the sequence with every collapsed block's derived
  // segment unmounted (a view-state skip — the rows stand in the
  // data; the local drag order and the commit run over the visible rows).
  const rowKeys = useMemo(
    () => visibleRows(rootChildren, derivation.byId, collapsedIds),
    [rootChildren, derivation, collapsedIds]
  );
  const nodesById = derivation.byId;

  /** The local row order: live during a drag (framer's reorder), locked to the store otherwise. */
  const [order, setOrder] = useState<BlockId[]>(rowKeys);
  /** The committed order (the release commit reads it — the ref mirrors the state after each render's DOM commit). */
  const orderRef = useRef(order);
  /** The framer drag key (a state mirror: it drives the rows' layout transition, the zIndex, and the render-phase resync skip). */
  const [draggingKey, setDraggingKey] = useState<BlockId | null>(null);
  /** The in-flight seam candidate (the dragged row's live preview indent; null between drags). */
  const [previewIndent, setPreviewIndent] = useState<number | null>(null);
  /** The layout slide armed: a drag in flight or the settle window after a structural change. */
  const [layoutSlide, setLayoutSlide] = useState(false);
  const slideTimerRef = useRef<number | null>(null);
  const prevKeysRef = useRef<BlockId[]>(rowKeys);

  /**
   * Keep the layout slide armed for the settle window after a drag or a
   * structural change, then release it so in-place content changes
   * reflow instantly again (the zero-duration layout transition).
   */
  const armSlide = useCallback(() => {
    if (slideTimerRef.current !== null) window.clearTimeout(slideTimerRef.current);
    slideTimerRef.current = window.setTimeout(() => {
      slideTimerRef.current = null;
      setLayoutSlide(false);
    }, SLIDE_SETTLE_MS);
    setLayoutSlide(true);
  }, []);

  useEffect(
    () => () => {
      if (slideTimerRef.current !== null) window.clearTimeout(slideTimerRef.current);
    },
    []
  );

  useLayoutEffect(() => {
    orderRef.current = order;
  }, [order]);

  // The drag's row vanished (a peer deleted it mid-drag): the session
  // state (the dragging key and the seam preview) is released here — the
  // release does not depend on framer delivering onDragEnd for the
  // unmounted row. The resync below (the next render, the dragging key
  // cleared) snaps the local order back to the store.
  if (draggingKey !== null && !rowKeys.includes(draggingKey)) {
    setDraggingKey(null);
    setPreviewIndent(null);
  }

  // A store change (remote or local, drag-free) resyncs the local order.
  // The render-phase setState (not an effect) keeps the committed DOM in
  // the store order within the same commit, so new rows mount immediately;
  // mid-drag changes are resynced on release instead (the render phase
  // skips the resync while a drag runs).
  if (draggingKey === null && !sameIds(order, rowKeys)) {
    setOrder(rowKeys);
  }

  // Arm the slide for the renders an enter/exit height animation does
  // not drive: a reorder of the surviving rows (a pure reorder, or an
  // insert that also reorders the rest) and any change that removes a
  // row (its pop leaves the survivors a position delta to slide). A pure
  // insert needs no slide — the entering row's height growth IS the
  // reflow — and an in-place content change (same keys, same order)
  // reflows instantly with no projection: a size projection would scale
  // the row while its text settles and distort the content.
  if (prevKeysRef.current !== rowKeys) {
    const prev = prevKeysRef.current;
    const removed = prev.some((key) => !rowKeys.includes(key));
    const prevCommon = prev.filter((key) => rowKeys.includes(key));
    const reordered = !sameIds(
      prevCommon,
      rowKeys.filter((key) => prev.includes(key))
    );
    if (removed || reordered) armSlide();
    prevKeysRef.current = rowKeys;
  }

  /**
   * The seam candidate at the pointer's Y (the drag's live preview and
   * the release's commit input share it): the visible rows' viewport
   * boxes against the seam rule (`reorder.ts`). Null when the measurement
   * is stale (the segment vanished, or the rows are gone) — the caller
   * keeps the preview (move) or skips the commit (release, the
   * render-phase resync snaps the order back to the store).
   */
  const seamCandidateAt = useCallback(
    (id: BlockId, pointerY: number): number | null => {
      const root = rootRef.current;
      if (root === null) return null;
      const containerId = entrySequenceParent(doc, rootBlockId);
      const segment = segmentRange(doc, containerId, id);
      if (segment === null) return null;
      const segmentIds = new Set(doc.getChildren(containerId).slice(segment.start, segment.end));
      const rows: DropRow[] = [];
      for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-slot="docblocks/row"]'))) {
        // The row's block id stands on its direct child (the block wrapper
        // — the row itself carries no id attribute).
        const wrapperId = el.querySelector<HTMLElement>("[data-block-id]")?.getAttribute("data-block-id") ?? null;
        if (wrapperId === null) continue;
        const node = nodesById.get(wrapperId);
        if (node === undefined) continue;
        // The row's SETTLED box: the static layout (the offsetTop chain —
        // transform-blind), not the live one. The rows slide on the layout
        // projection while a drag runs, and the live boxes would stand
        // mid-slide at the release (a stale seam measurement). The chain
        // assumes no positioned/fixed ancestor above the editor (a
        // position: fixed embedding would offset every box by a constant —
        // the commit's guards keep such a measurement from committing a
        // wrong seam).
        let top = 0;
        for (
          let ancestor: HTMLElement | null = el;
          ancestor !== null;
          ancestor = ancestor.offsetParent as HTMLElement | null
        ) {
          top += ancestor.offsetTop;
        }
        top -= window.scrollY;
        rows.push({ id: wrapperId, top, bottom: top + el.offsetHeight, indent: node.indent });
      }
      if (rows.length === 0) return null;
      return dropCandidateIndent(rows, pointerY, segmentIds, id);
    },
    [doc, nodesById, rootBlockId, rootRef]
  );

  /** The row's drag start: the slide arms, the row lifts (the zIndex). */
  const onRowDragStart = useCallback(
    (id: BlockId) => {
      armSlide();
      setDraggingKey(id);
      setPreviewIndent(null);
    },
    [armSlide]
  );

  /**
   * The drag's live seam candidate (the preview's source): the pointer's
   * Y against the visible rows' boxes — the same measurement the drop's
   * commit validates, so the preview stands where the drop lands. Pure
   * preview: the doc, the wire, and the store are untouched.
   */
  const onRowDragMove = useCallback(
    (id: BlockId, event: PointerEvent | MouseEvent | TouchEvent) => {
      const pointerY = pointerYOf(event);
      if (pointerY === null) return;
      const candidate = seamCandidateAt(id, pointerY);
      if (candidate === null) return; // a stale measurement — the preview stands
      setPreviewIndent(candidate);
    },
    [seamCandidateAt]
  );

  /**
   * The row's release: the flat-range commit plus the seam's indent
   * (one transact — one undo step, one wire update). A no-op drop (the
   * segment landed in place) and a stale drop (a remote update changed
   * the sequence mid-drag — the derived final order is not the current
   * sequence with the segment moved, or the seam's candidate matches
   * neither seam neighbor) issue no command; the render-phase resync
   * then snaps the local order back to the store.
   */
  const onRowDragEnd = useCallback(
    (id: BlockId, event: PointerEvent | MouseEvent | TouchEvent) => {
      armSlide();
      setDraggingKey(null);
      // Park the focus on the editor root (the gesture's contract — like
      // the gutter's delete): the undo / redo hotkeys stay reachable after
      // the release (the drag's pointer capture leaves the focus on body).
      rootRef.current?.focus({ preventScroll: true });
      const pointerY = pointerYOf(event);
      setPreviewIndent(null);
      if (pointerY === null) return; // a stale release measurement — the resync stands
      const candidate = seamCandidateAt(id, pointerY);
      if (candidate === null) {
        // The release's measurement is stale (no rows, or the segment
        // vanished) — the render-phase resync snaps the order back.
        return;
      }
      commitFlatDrag(doc, rootBlockId, id, orderRef.current, store.getState().collapsedIds, candidate);
    },
    [armSlide, doc, orderRef, rootBlockId, rootRef, seamCandidateAt, store]
  );

  // The cross-drag selection session owns the root's pointerdown (the
  // rows' drag start is the gutter handle's pointerdown — a text inner
  // press and a gutter press are mutually exclusive targets).
  const onRootPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    onCrossDragPointerDown(event);
  };

  return (
    // The shared Card carries the editor's frame chrome (border, radius,
    // the card surface). In the canvas view it takes the flex column's
    // slack: the 100% height chain below the root needs a definite height.
    // The inner div is the editor root: the focus and keyboard scope and
    // the token-mapping scope.
    <Card className={cn(view === "canvas" && "min-h-0 flex-1")}>
      <div
        ref={rootRef}
        data-slot="docblocks/editor"
        data-docblocks-motion=""
        data-view={view}
        tabIndex={-1}
        className={cn(
          "relative min-h-0 flex-1 selection:bg-(--docblocks-selection-background)",
          "font-(family-name:--docblocks-font-family) text-(length:--docblocks-font-size)",
          // The page view keeps the block content inside the card frame (the
          // gutter grip stands in the left margin band, not past the border);
          // the canvas view owns its own viewport and is unpadded.
          view === "page" && "px-(--docblocks-page-padding-x)",
          "leading-(--docblocks-line-height) text-(--docblocks-text-color)"
        )}
        onKeyDown={onKeyDown}
        onCopy={onCopy}
        onPointerDown={onRootPointerDown}
      >
        <style>{HANDLE_GRAB_STYLE}</style>
        <SlashMenuContext.Provider value={slash.api}>
          <FormatPaletteContext.Provider value={formatPalette}>
            <BlockContext.Provider value={rootContext}>
              {view === "canvas" ? (
                <CanvasView />
              ) : (
                <Reorder.Group
                  as="div"
                  axis="y"
                  values={order}
                  onReorder={(next) =>
                    setOrder(
                      // The tail seat's clamp (the preview side): the full-doc
                      // root's trailing text paragraph stands last — a
                      // non-text-terminated dragged row stands above it (the
                      // release's commit stands the same landing, so the
                      // preview and the drop agree; a text-terminated
                      // segment lands its text tail last — the invariant
                      // stands and the crossing is clean).
                      clampTailSeatCrossing(
                        next as BlockId[],
                        draggingKey ?? "",
                        rootBlockId === doc.meta.id && draggingKey !== null
                          ? tailSeatId(doc, rootBlockId, draggingKey, rowKeys[rowKeys.length - 1])
                          : undefined
                      )
                    )
                  }
                >
                  <AnimatePresence initial={false} mode="sync">
                    {order.map((id) => {
                      const node = nodesById.get(id);
                      if (node === undefined) return null;
                      return (
                        <RowItem
                          key={id}
                          node={node}
                          layoutSlide={layoutSlide || draggingKey !== null}
                          isDragged={draggingKey === id}
                          animated={enterGate.current}
                          previewIndent={draggingKey === id ? previewIndent : null}
                          onDragStart={() => onRowDragStart(id)}
                          onDragEnd={(event) => onRowDragEnd(id, event)}
                          onDragMove={(event) => onRowDragMove(id, event)}
                        />
                      );
                    })}
                  </AnimatePresence>
                </Reorder.Group>
              )}
              <PresenceCaretOverlay rootRef={rootRef} />
            </BlockContext.Provider>
          </FormatPaletteContext.Provider>
        </SlashMenuContext.Provider>
        {slash.menuNode}
        {format.toolbarNode}
      </div>
    </Card>
  );
}

export { MotionEditor };
