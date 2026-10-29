/**
 * `MotionEditor` — the animated editor view, a drop-in replacement for the
 * base `Editor` under the same `EditorProvider`: the same root element
 * (the focus/keyboard scope), the same block rendering and editing
 * wiring, and the same presence overlay. The page view renders the FLAT
 * page sequence (every page block is its own `Reorder.Item` row), the
 * top-level rows render through `AnimatePresence` (`sync`), and the
 * drag-reorder is pure framer `Reorder` (one drag = one range move of the
 * dragged block's derived subtree).
 */
import { useStore } from "zustand";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import type { BlockId } from "docblocks-core";

import type { EditorView } from "../Editor";
import { useEditorContext } from "../EditorProvider";
import { CanvasView } from "../blocks/canvas-view";
import { BlockContext } from "../blocks/block-context";
import { deriveFlat, entrySequenceParent, visibleRows } from "../blocks/flat";
import type { FlatNode } from "../blocks/flat";
import { FormatPaletteContext } from "../blocks/format-palette-context";
import { EnumOptionsMotionSlot } from "../database/grid/enum-options-motion";
import { segmentRange } from "../editing/block-commands";
import { FORMAT_PALETTE, useFormatToolbar } from "../editing/format-toolbar";
import { MentionMenuContext, useMentionMenu } from "../editing/mention";
import { SlashMenuContext, useSlashMenu } from "../editing/slash";
import { useEditing } from "../editing/useEditing";
import { PresenceCaretOverlay } from "../presence/presence-caret";
import { Card } from "../shared/ui/Card";
import { cn } from "../shared/ui/cn";
import { MotionEnumOptionsEditor } from "./EnumOptions";
import { RowList } from "./RowList";
import { useEnterAnimationGate, useTypingFlag } from "./hooks";
import { HANDLE_GRAB_STYLE, SLIDE_SETTLE_MS } from "./models";
import { type DropRow, clampTailSeatCrossing, commitFlatDrag, dropCandidateIndent, sameIds } from "./reorder";
import { pointerYOf, tailSeatId } from "./utils";

function MotionEditor({
  view = "page",
  formatPalette = FORMAT_PALETTE,
}: {
  view?: EditorView;
  formatPalette?: readonly string[];
}) {
  const { doc, store, rootBlockId } = useEditorContext();
  const rootChildren = useStore(store, (state) => state.rootChildren);
  // The sequence-structure stamp (the derivation's key): a text-only edit
  // stands nothing here — the edited row re-renders through its own
  // subscription, the row list and the rows' framer fibers stand.
  const seqStamp = useStore(store, (state) => state.seqStamp);
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
  const mention = useMentionMenu(rootRef);
  const format = useFormatToolbar(rootRef, formatPalette);
  useTypingFlag(rootRef);
  const enterGate = useEnterAnimationGate(rootRef);

  // The flat page sequence, derived per structure change (the store stays a
  // flat map projection). The stamp's rule: every derivation-affecting
  // change bumps it (a text/mark change stands nothing — the interned rows
  // keep their identity and the block's own subscription re-renders it).
  // The interning cache: the previous derivation's byId stands while the
  // sequence's data is unchanged (the row memo is keyed on the node
  // identity). The blocks map is read from the store's live state (the
  // stamp and the map advance in the same atomic write — the map stands
  // fresh whenever the stamp does).
  const prevRef = useRef<Map<string, FlatNode> | null>(null);
  const derivation = useMemo(() => {
    const result = deriveFlat(rootChildren, store.getState().blocks, prevRef.current ?? undefined);
    prevRef.current = result.byId;
    return result;
  }, [rootChildren, seqStamp, store]);
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

  /**
   * The framer reorder's live preview (the row order's local state): the
   * tail seat's clamp (the preview side) — the full-doc root's trailing
   * text paragraph stands last, a non-text-terminated dragged row stands
   * above it (the release's commit stands the same landing, so the
   * preview and the drop agree; a text-terminated segment lands its text
   * tail last — the invariant stands and the crossing is clean).
   */
  const onRowReorder = useCallback(
    (next: BlockId[]) => {
      setOrder(
        clampTailSeatCrossing(
          next,
          draggingKey ?? "",
          rootBlockId === doc.meta.id && draggingKey !== null
            ? tailSeatId(doc, rootBlockId, draggingKey, rowKeys[rowKeys.length - 1])
            : undefined
        )
      );
    },
    [doc, draggingKey, rootBlockId, rowKeys]
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
      {/* The database's enum's options' editor stands the motion's variant
          (the framer's Reorder's rows) over this provider — the database
          block's grid renders through the base's BlockView, so the swap
          stands the context, not the renderer's registry. */}
      <EnumOptionsMotionSlot.Provider value={MotionEnumOptionsEditor}>
        <div
          ref={rootRef}
          data-slot="docblocks/editor"
          data-docblocks-motion=""
          data-view={view}
          tabIndex={-1}
          className={cn(
            "relative min-h-0 flex-1 selection:bg-(--docblocks-selection-background)",
            "font-(family-name:--docblocks-font-family) text-(length:--docblocks-font-size)",
            "leading-(--docblocks-line-height) text-(--docblocks-text-color)"
          )}
          onKeyDown={onKeyDown}
          onCopy={onCopy}
          onPointerDown={onRootPointerDown}
        >
          <style>{HANDLE_GRAB_STYLE}</style>
          <MentionMenuContext.Provider value={mention.api}>
            <SlashMenuContext.Provider value={slash.api}>
              <FormatPaletteContext.Provider value={formatPalette}>
                <BlockContext.Provider value={rootContext}>
                  {view === "canvas" ? (
                    <CanvasView />
                  ) : (
                    // The page's content column: the derived max width over
                    // the centered stand (the block content's width — the
                    // --docblocks-page-max-width token — + the two gutter
                    // paddings: the token stands on the blocks, the paddings
                    // stand outside it; the symmetric margins over the wide
                    // window, the full width over the narrow one) + the
                    // padding (the gutter band stands inside the column, so
                    // the grip follows the content's edge, not the
                    // viewport's). The canvas view owns its own viewport and
                    // is unpadded.
                    <div
                      data-slot="docblocks/page"
                      className="
                        mx-auto w-full max-w-(--docblocks-page-column-max-width) px-(--docblocks-page-padding-x)
                      "
                    >
                      <RowList
                        order={order}
                        nodesById={nodesById}
                        layoutSlide={layoutSlide || draggingKey !== null}
                        draggingKey={draggingKey}
                        previewIndent={previewIndent}
                        animated={enterGate.current}
                        onReorder={onRowReorder}
                        onDragStart={onRowDragStart}
                        onDragMove={onRowDragMove}
                        onDragEnd={onRowDragEnd}
                      />
                    </div>
                  )}
                  <PresenceCaretOverlay rootRef={rootRef} />
                </BlockContext.Provider>
              </FormatPaletteContext.Provider>
            </SlashMenuContext.Provider>
          </MentionMenuContext.Provider>
          {slash.menuNode}
          {mention.menuNode}
          {format.toolbarNode}
        </div>
      </EnumOptionsMotionSlot.Provider>
    </Card>
  );
}

export { MotionEditor };
