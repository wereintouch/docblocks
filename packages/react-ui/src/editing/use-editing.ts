import { useEffect, useRef } from "react";
import type { ClipboardEvent, KeyboardEvent, PointerEvent, RefObject } from "react";

import type { Doc, Selection, SelectionView } from "docblocks-core";

import { entrySequenceParent } from "../blocks";
import { useEditorContext } from "../editor-provider";
import {
  ensureTrailingParagraph,
  focusCaretIn,
  moveSegmentInSequence,
  removeBlocksSelection,
  reseatHistorySelection,
  segmentRange,
} from "./block-commands";
import { crossRangeClipboardContent, segmentOf } from "./cross-copy";
import { containerCaretNeedsReseat, reseatContainerCaret } from "./page-surface";
import { domSelectionInEditable, mapDomSelection, selectionsEqual } from "./selection-mapping";
import { useCrossDrag } from "./use-cross-drag";

/**
 * The history reseat's window over the undo/redo (the remount's transient
 * selection loss's stand): the window's end stands the mapping's none's
 * suppression. The engine's remount commit + the selectionchange's settle
 * stands the sub-second over the load, so the window stands a margin over
 * it (the staleness is bounded by the window's end; the explicit paths —
 * the Escape, the gutter's reset — stand the real clear).
 */
const RESEAT_WINDOW_MS = 2000;

/**
 * The undo/redo's reseat over the engine's event ordering: the fast path
 * re-reads the view over the synchronous read (the restoration's stand
 * lands inside the undo/redo call), and the window's stand re-runs the
 * reseat when the restoration's emission lands over the transaction's
 * settle (the engine's ordering stands the popped's event after the
 * handler's return — the reseat then reads the restored state). The
 * reseat's own stands (the user's live selection's stop, the seated's
 * short-circuit) keep the re-runs from clobbering.
 */
function scheduleHistoryReseat(doc: Doc, view: SelectionView | null, root: HTMLDivElement | null): void {
  if (view === null) return;
  const scope = root ?? document;
  const run = (): void => {
    reseatHistorySelection(doc, view, scope);
  };
  run();
  let alive = true;
  const unsubscribe = view.onChange((selection: Selection) => {
    if (!alive) return;
    if (selection.kind !== "text") return;
    // The frame's delay over the emit's read: the emit may be the
    // transaction's rebase (the intermediate state the popped event's
    // restoration overwrites in the same commit phase) — the frame stands
    // the commit's settle, and the read gets the restored state, not the
    // rebased residue (a residue seat lands at the block's edge over the
    // pre-gesture's and outlives the watch's deadline).
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => alive && run());
    else window.setTimeout(() => alive && run(), 0);
  });
  window.setTimeout(() => {
    alive = false;
    unsubscribe();
  }, RESEAT_WINDOW_MS);
}

interface EditingHandle {
  /** Attach to the editor root element. */
  rootRef: RefObject<HTMLDivElement | null>;
  /** The undo/redo hotkeys; attach to the editor root element. */
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  /** The cross-range copy payload; attach to the editor root element. */
  onCopy: (event: ClipboardEvent<HTMLDivElement>) => void;
  /** The cross-drag selection session; attach the pointerdown to the editor root element. */
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
}

/**
 * Document-level wiring owned by the editor root: `selectionchange` maps
 * the DOM selection to the core Selection view, the mod+z / mod+shift+z /
 * mod+y hotkeys drive doc.undo()/doc.redo(), and the copy event carries
 * the cross-range payload (the keydown and copy listeners live on the
 * root, so they never fire outside the editor).
 *
 * The selection view is read at event time through the stable context
 * handle: the view becomes live when the provider's mount effect runs,
 * which is after this hook's effect subscribed (child effects run first),
 * so a render-time value would be a stale null.
 */
function useEditing(): EditingHandle {
  const { doc, rootBlockId, selection: selectionRef, viewMode } = useEditorContext();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const crossDrag = useCrossDrag(rootRef, doc);

  useEffect(() => {
    // The read-only stand (view / published): the DOM selection stands no
    // stand (the user-select's none) — the mapping is skipped.
    if (viewMode) return;
    const onSelectionChange = () => {
      const root = rootRef.current;
      const view = selectionRef.view;
      if (root === null || view === null) return;
      // The page container's own caret (the transient stand over a gap
      // click / a remount residue): re-seat it into the nearest block's
      // edge before the mapping reads it (the reseat's own selectionchange
      // stands the mapping over the seated caret). Skipped over a `blocks`
      // view (the blocks selection's caret is parked, not a stranded one —
      // the reseat's inner landing would hand the mapping a text view
      // clobbering the blocks' stand).
      const pageContainer = root.querySelector<HTMLElement>("[data-slot='docblocks/page']");
      const pageSelection = window.getSelection();
      // The history's reseat window (the undo/redo's remount) owns the
      // post-remount carets: the container's re-seat must not race it
      // (its edge seat lands at the block's start while the history's
      // seat is the pre-gesture's, and the late transient would clobber
      // the corrected seat).
      if (
        pageContainer !== null &&
        view.get().kind !== "blocks" &&
        Date.now() >= selectionRef.reseatUntil.current &&
        pageSelection !== null &&
        pageSelection.isCollapsed &&
        containerCaretNeedsReseat(pageContainer, pageSelection.anchorNode)
      ) {
        reseatContainerCaret(pageContainer, root, doc);
        return;
      }
      const next = mapDomSelection(root, window.getSelection(), doc);
      const current = view.get();
      // A `blocks` view (the gutter / canvas selection) has no DOM
      // expression: a selection settling outside the editables (the canvas
      // chrome, the stale residue, a `none` mapping) cannot express it, so
      // the mapping never clobbers a blocks view there. A caret inside an
      // editable still wins (the page's gutter→text click); a gutter
      // selection is cleared by the explicit paths (Escape, a new
      // selection, the delete), not by the background click.
      if (current.kind === "blocks" && !domSelectionInEditable(window.getSelection())) return;
      // The canvas view's page miniature (the two-click contract): the
      // blocks (card) selection stands over the caret the second press
      // plants (the caret is the editing path, not a selection clobber).
      const anchorNode = window.getSelection()?.anchorNode ?? null;
      const anchorHost = anchorNode instanceof Element ? anchorNode : (anchorNode?.parentElement ?? null);
      if (anchorHost?.closest('[data-slot="docblocks/page-card"]') !== null) return;
      // The history reseat's window: the undo/redo's inverse may remount the
      // block, and the engine's selection stands the remount's transient
      // loss (the selectionchange over the commit reads the residue — the
      // none's stand, the engine's anchor's wander over the wrapper's
      // blocks' stand), not the user's clear. The window suppresses the
      // residue's non-text mapping (the user's clear stands the explicit
      // paths: the Escape, the editor's outside's focus, the gutter's
      // click's own set).
      if (next.kind !== "text" && Date.now() < selectionRef.reseatUntil.current) return;
      // The history reseat's window suppresses the remount's transient text
      // mapping too: the remount collapses the DOM selection to an
      // element-position anchor (the inner's edge, the row) that maps as a
      // text caret at the block's start and would clobber the restored
      // seat. A text-node anchor is a live seat (the user's or the
      // reseat's own) and stands.
      if (next.kind === "text" && Date.now() < selectionRef.reseatUntil.current) {
        const anchor = window.getSelection()?.anchorNode ?? null;
        if (anchor === null || anchor.nodeType !== Node.TEXT_NODE) return;
      }
      // The view emits even on no-op sets — only push a real change.
      if (!selectionsEqual(next, view.get())) view.set(next);
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [doc, selectionRef, viewMode]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // The read-only stand (view / published): the hotkeys stand no
    // stand (the undo/redo's path and the blocks selection's delete are
    // editing's paths).
    if (viewMode) return;
    // Keys typed inside a nested editor (a sync-embed) bubble up to this
    // root; that editor's own hotkeys handle them, so this root must not
    // double-fire undo/redo.
    const root = rootRef.current;
    const target = event.target instanceof Element ? event.target : null;
    const nearest = target?.closest('[data-slot="docblocks/editor"]') ?? null;
    if (root !== null && nearest !== null && nearest !== root) return;
    // A key from a portaled form control (the shape toolbar's hex input
    // stands in the document body): the DOM path never crosses the root,
    // and the control owns its own keys (a Backspace in the input must
    // not delete the blocks selection). A dropped focus (the target
    // body/document) is NOT a form control — the undo hotkey must still
    // reach the doc from there (the focus-parking contract).
    const formControl = target?.closest("input, textarea, [contenteditable='true']") ?? null;
    if (root !== null && target !== null && formControl !== null && !root.contains(target)) return;
    const view = selectionRef.view;
    if (view !== null) {
      const selection = view.get();
      if (selection.kind === "blocks") {
        // The blocks (gutter) selection's keys on a row no per-block
        // handler owns (the non-text rows: the row wrapper is focused and
        // its keydown bubbles here). A text row's own wrapper handles the
        // same keys earlier on the event path and resets the view to
        // none, so there is no double fire.
        if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          // The image's delete is a conversion to an empty plain paragraph
          // in place (the image's attrs drop), and the caret seats there —
          // the block is never removed (a single-image selection; a
          // multi-selection deletes as usual).
          const first = selection.ids[0];
          if (selection.ids.length === 1 && first !== undefined && doc.getBlock(first)?.type === "image") {
            doc.changeBlockType(first, "paragraph");
            // The type change remounts the row (the image figure unmounts
            // and the browser drops the focus to the document): park it on
            // the editor root (the undo hotkey reach) and re-seat the
            // caret in the survivor on the next frame.
            root?.focus();
            focusCaretIn(first, 0, root ?? document);
            return;
          }
          removeBlocksSelection(doc, entrySequenceParent(doc, rootBlockId), selection.ids);
          view.set({ kind: "none" });
          // The document root's tail guarantee (the gesture's one
          // transact stands the stand): the removal stands a non-text last
          // block (or the empty sequence) — the empty paragraph stands
          // after it and the caret seats there (the typeable home; the
          // undo hotkey still reaches the editor from the row's focus).
          if (rootBlockId === doc.meta.id) {
            const trailingId = ensureTrailingParagraph(doc, doc.meta.id);
            if (trailingId !== null && root !== null) {
              focusCaretIn(trailingId, 0, root);
              return;
            }
          }
          // The deleted rows unmount and the browser would drop the focus to
          // the document: park it on the editor root (the undo hotkey reach).
          root?.focus();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          view.set({ kind: "none" });
          return;
        }
        // mod+shift+arrow (the single block's derived segment's move): the
        // shared page model's focus parks on the editor root (or stands on
        // the page container), so the key's target stands one of them and
        // the per-block inner's handler (the text row's stand) owns the
        // descent from a wrapper / inner target — the root takes the move
        // only over its own targets (no double fire over the inner's path).
        if (root !== null) {
          const pageContainer = root.querySelector<HTMLElement>("[data-slot='docblocks/page']");
          const isOwnTarget = event.target === root || event.target === pageContainer;
          if (
            isOwnTarget &&
            (event.metaKey || event.ctrlKey) &&
            event.shiftKey &&
            (event.key === "ArrowUp" || event.key === "ArrowDown") &&
            selection.ids.length === 1 &&
            selection.ids[0] !== undefined
          ) {
            const id = selection.ids[0]!;
            const siblings = doc.getChildren(rootBlockId);
            if (siblings.includes(id)) {
              const segment = segmentRange(doc, rootBlockId, id);
              if (segment !== null) {
                const length = segment.end - segment.start;
                const isSurface = (candidate: (typeof siblings)[number]): boolean =>
                  doc.getBlock(candidate)?.type === "surface";
                let target: number | null = null;
                if (event.key === "ArrowUp") {
                  let i = segment.start - 1;
                  while (i >= 0 && isSurface(siblings[i]!)) i -= 1;
                  if (i >= 0) target = i;
                } else {
                  let j = segment.end;
                  while (j < siblings.length && isSurface(siblings[j]!)) j += 1;
                  if (j < siblings.length) target = j + 1;
                }
                if (target !== null) {
                  event.preventDefault();
                  moveSegmentInSequence(doc, rootBlockId, segment.start, length, target);
                  view.set({ kind: "blocks", ids: [id], anchorId: id });
                  return;
                }
              }
            }
          }
        }
      }
    }
    const mod = event.metaKey || event.ctrlKey;
    if (!mod) return;
    const key = event.key.toLowerCase();
    if (key === "z" && !event.shiftKey) {
      event.preventDefault();
      doc.undo();
      // The inverse step may remount the restored selection's block (a
      // type change): the remount takes the DOM caret and focus with the
      // old element, so the restored selection re-seats the DOM. The
      // reseat's window stands the remount's transient selection loss
      // (the mapping's none's suppression — the inverse's next snapshot
      // then reads the restored state, not the residue).
      selectionRef.reseatUntil.current = Date.now() + RESEAT_WINDOW_MS;
      scheduleHistoryReseat(doc, view, root);
    } else if ((key === "z" && event.shiftKey) || key === "y") {
      event.preventDefault();
      doc.redo();
      // The redo's step is the same remount case in the other direction
      // (the forward type change takes the old element out from under
      // the seat).
      selectionRef.reseatUntil.current = Date.now() + RESEAT_WINDOW_MS;
      scheduleHistoryReseat(doc, view, root);
    }
  };

  const onCopy = (event: ClipboardEvent<HTMLDivElement>) => {
    // The read-only stand (view / published): the cross-range's copy is
    // off (the selection stands no stand there).
    if (viewMode) return;
    // A copy from a nested editor (a sync-embed) bubbles up to this root;
    // that editor's own copy handler owns its payload.
    const root = rootRef.current;
    const view = selectionRef.view;
    if (root === null || view === null) return;
    const target = event.target instanceof Element ? event.target : null;
    const nearest = target?.closest('[data-slot="docblocks/editor"]') ?? null;
    if (nearest !== null && nearest !== root) return;
    // The browser cannot copy a selection across a contenteditable
    // boundary: a cross-block range is serialized from the doc (the
    // covered segment of each chain block); same-block copies keep the
    // default copy.
    const selection = view.get();
    // A same-block text range that includes a mention: serialize the segment
    // (the mention copies as `@label`, not the chip's bare label). A segment
    // without a mention keeps the default copy (the native fidelity).
    if (
      selection.kind === "text" &&
      selection.to !== null &&
      selection.to.blockId === selection.from.blockId &&
      selection.from.offset < selection.to.offset
    ) {
      const block = doc.getBlock(selection.from.blockId);
      const content = block !== null && "content" in block ? block.content : undefined;
      if (content !== undefined) {
        let runStart = 0;
        let hasMention = false;
        for (const run of content) {
          const runEnd = runStart + run.text.length;
          if (run.marks.mention !== undefined && runStart < selection.to.offset && runEnd > selection.from.offset) {
            hasMention = true;
            break;
          }
          runStart = runEnd;
        }
        if (hasMention) {
          const segment = segmentOf(content, selection.from.offset, selection.to.offset);
          event.preventDefault();
          event.clipboardData.setData("text/plain", segment.text);
          event.clipboardData.setData("text/html", segment.html);
          return;
        }
      }
    }
    const payload = crossRangeClipboardContent(doc, selection);
    if (payload === null) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", payload.text);
    event.clipboardData.setData("text/html", payload.html);
  };

  return {
    rootRef,
    onKeyDown,
    onCopy,
    // The read-only stand (view / published): the cross-drag's session is
    // off (the selection's gesture is an editing's path).
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (viewMode) return;
      crossDrag.onPointerDown(event);
    },
  };
}

export { useEditing };
export type { EditingHandle };
