/** The motion editor's drag-reorder session (pure framer `Reorder` — one
 * drag = one range move of the dragged block's derived subtree): the local
 * row order (live during a drag, locked to the store otherwise) + the
 * committed order's ref + the framer drag key + the in-flight seam
 * candidate + the layout slide's arm. The 2 resyncs (the drag's row
 * vanished — a peer deleted it mid-drag; a store change (remote or local,
 * drag-free) resyncs the local order) + the 3 drag handlers (the row's
 * drag start, the drag's live seam candidate, the row's release) + the
 * framer reorder's live preview (the tail seat's clamp). The seam
 * candidate at the pointer's Y (the drag's live preview and the release's
 * commit input share it) — the visible rows' viewport boxes against the
 * seam rule. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import type { BlockId } from "docblocks-core";
import type { Doc } from "docblocks-core";

import { entrySequenceParent } from "../blocks";
import type { FlatNode } from "../blocks";
import { segmentRange } from "../editing/block-commands";
import type { EditorStore } from "../state";
import { SLIDE_SETTLE_MS } from "./constants";
import { type DropRow, clampTailSeatCrossing, commitFlatDrag, dropCandidateIndent, sameIds } from "./reorder";
import { pointerYOf, tailSeatId } from "./utils";

/** The local row order: live during a drag (framer's reorder), locked to the store otherwise. */
export function useMotionDrag({
  doc,
  rootBlockId,
  store,
  rootRef,
  rowKeys,
  nodesById,
}: {
  doc: Doc;
  rootBlockId: BlockId;
  store: EditorStore;
  rootRef: RefObject<HTMLDivElement | null>;
  rowKeys: BlockId[];
  nodesById: Map<string, FlatNode>;
}) {
  // The local row order: live during a drag (framer's reorder), locked to the store otherwise.
  const [order, setOrder] = useState<BlockId[]>(rowKeys);
  // The committed order (the release commit reads it — the ref mirrors the state after each render's DOM commit).
  const orderRef = useRef(order);
  // The framer drag key (a state mirror: it drives the rows' layout transition, the zIndex, and the render-phase resync skip).
  const [draggingKey, setDraggingKey] = useState<BlockId | null>(null);
  // The in-flight seam candidate (the dragged row's live preview indent; null between drags).
  const [previewIndent, setPreviewIndent] = useState<number | null>(null);
  // The layout slide armed: a drag in flight or the settle window after a structural change.
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

  return {
    order,
    draggingKey,
    previewIndent,
    layoutSlide,
    onRowDragStart,
    onRowDragMove,
    onRowDragEnd,
    onRowReorder,
  };
}
