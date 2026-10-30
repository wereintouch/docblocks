import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent } from "react";

import type { BlockId, Doc } from "docblocks-core";

import { locatePosition } from "./dom-offset";

interface DragPosition {
  blockId: BlockId;
  node: Node;
  offset: number;
}

interface CrossDragSession {
  pointerId: number;
  anchor: DragPosition;
  moved: boolean;
  /** The last pointer position the selection was seated on. */
  last: DragPosition | null;
}

/**
 * The DOM selection from the drag anchor to the pointer position. Chromium
 * degenerates a reverse cross-editable selection whose base stands at
 * offset 0 (the base seats "before" the editable's content, and the range
 * collapses): that one case is seated forward instead — the from/to stay
 * correct, only the drag-direction flag is lost.
 */
function seatCrossSelection(anchor: DragPosition, position: DragPosition): void {
  const anchorBefore = (anchor.node.compareDocumentPosition(position.node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  const base = anchorBefore || anchor.offset !== 0 ? anchor : position;
  const focus = base === anchor ? position : anchor;
  window.getSelection()?.setBaseAndExtent(base.node, base.offset, focus.node, focus.offset);
}

/**
 * The text position under (x, y) inside the editor's own scope: the
 * browser's caret position when the pointer stands in a text inner of
 * THIS editor (a nested sync-embed editor's inners are excluded — a
 * foreign position would seat the DOM selection across the boundary and
 * the mapping would drop the view), otherwise the nearest text edge by
 * geometry (the pointer over a gap, a marker, or a non-text block stands
 * at that block's head or tail by its horizontal position). Null when
 * there is no own-scope text to stand on.
 */
function positionAtPoint(doc: Doc, root: HTMLElement, x: number, y: number): DragPosition | null {
  // The WebKit caret-range API (Chrome / Safari); the standard caretPositionFromPoint
  // is Firefox-only and the geometry fallback below stands the non-WebKit positions.
  // deprecation-allow: the WebKit caret-range API.
  const caretRange = typeof document.caretRangeFromPoint === "function" ? document.caretRangeFromPoint(x, y) : null;
  if (caretRange !== null) {
    const container =
      caretRange.startContainer instanceof Element
        ? caretRange.startContainer
        : (caretRange.startContainer.parentElement ?? null);
    const inner = container?.closest<HTMLElement>('[data-slot="docblocks/block-content"]') ?? null;
    if (inner !== null && root.contains(inner) && inner.closest('[data-slot="docblocks/editor"]') === root) {
      return {
        blockId: inner.dataset.blockId as BlockId,
        node: caretRange.startContainer,
        offset: caretRange.startOffset,
      };
    }
  }
  // Geometric fallback: the text inner with the smallest vertical
  // distance to the pointer (a pointer inside a box has distance zero);
  // the head when the pointer stands in its left quarter, the tail
  // otherwise.
  let best: { el: HTMLElement; distance: number } | null = null;
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-slot="docblocks/block-content"]'))) {
    // Own scope only (a nested editor's inners are not candidates).
    if (el.closest('[data-slot="docblocks/editor"]') !== root) continue;
    const box = el.getBoundingClientRect();
    if (box.height === 0) continue;
    const distance = y < box.top ? box.top - y : y > box.bottom ? y - box.bottom : 0;
    if (best === null || distance < best.distance) best = { el, distance };
  }
  if (best === null) return null;
  const box = best.el.getBoundingClientRect();
  const blockId = best.el.dataset.blockId as BlockId;
  const atHead = x < box.left + Math.max(8, box.width / 4);
  const offset = atHead ? 0 : doc.getTextLength(blockId);
  const position = locatePosition(best.el, offset);
  return { blockId, node: position.node, offset: position.offset };
}

/**
 * The text selection by mouse drag, in-block and across block boundaries:
 * the browser cannot extend a selection across a contenteditable boundary
 * (neither a drag nor a native shift+arrow), and its own drag session
 * would re-assert its (in-block-only) selection after the editor's, so
 * while a session is active the editor is the selection's sole writer —
 * the session's mousedown default action is suppressed (that is what
 * starts the browser's drag session; the caret seat and the focus move
 * with it, so both are stood up by the editor at the session end) and
 * the selection is seated from the pointer position on every move. The
 * anchor stands at the pointer position of the pointerdown (the
 * pointerdown fires before the browser would seat its caret, so the DOM
 * selection is not read), and the focus end follows the pointer through
 * the other blocks (the selectionchange mapping then keeps the view
 * selection in sync, per block). The session ends on pointerup/cancel:
 * a click without a drag re-seats the caret at the anchor (the plain
 * click behavior), a drag leaves the selection where the pointer left it.
 *
 * The multi-click selects are the browser's own word select (the double
 * press) — the session's mousedown suppression stands only for the first
 * press (the multi-click's own mousedown tears the session down and lets
 * the default action stand; the pointer's detail stands 0 under synthetic
 * input, the mousedown's stands the real count, so the decision stands on
 * the mousedown's). The triple press is the editor's: the browser's
 * "paragraph" select of a pre-wrap block stands at one visual line (the
 * soft-break lines), so a detail-3 press inside a text inner is
 * suppressed and the editor stands the whole-block selection (all the
 * soft-break lines) itself — a permanent capture listener, independent of
 * the session (the real pointer's third press starts no session: the
 * pointer's detail stands 3 and the session guard returns).
 */
function useCrossDrag(rootRef: { current: HTMLElement | null }, doc: Doc) {
  const sessionRef = useRef<CrossDragSession | null>(null);

  // The window listeners are stable for the hook's lifetime (they read
  // everything through refs), so a session that spans re-renders keeps
  // the very listeners it registered.
  const handlersRef = useRef<{
    move: (event: WindowEventMap["pointermove"]) => void;
    end: (event: WindowEventMap["pointerup"]) => void;
    mousedown: (event: MouseEvent) => void;
  } | null>(null);
  if (handlersRef.current === null) {
    const move = (event: WindowEventMap["pointermove"]) => {
      const session = sessionRef.current;
      const root = rootRef.current;
      if (session === null || root === null || event.pointerId !== session.pointerId) return;
      const position = positionAtPoint(doc, root, event.clientX, event.clientY);
      if (position === null) return;
      session.moved = true;
      session.last = position;
      seatCrossSelection(session.anchor, position);
    };
    const end = (event: WindowEventMap["pointerup"]) => {
      const session = sessionRef.current;
      const root = rootRef.current;
      if (session === null || root === null || event.pointerId !== session.pointerId) return;
      sessionRef.current = null;
      // The seat stands on the drag endpoints (or on the anchor as a plain
      // caret for a click without a drag — the plain click behavior). No
      // explicit focus move: the suppressed mousedown default action
      // dropped the browser's focus move, and setBaseAndExtent stands the
      // document focus on the base's editable itself — a focus() on the
      // other block would collapse the cross selection, and the keys
      // bubble to the root handlers regardless of the focused block.
      if (session.moved && session.last !== null) seatCrossSelection(session.anchor, session.last);
      else if (!session.moved) {
        window
          .getSelection()
          ?.setBaseAndExtent(session.anchor.node, session.anchor.offset, session.anchor.node, session.anchor.offset);
      }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("mousedown", mousedown, true);
    };
    // The browser's selection drag starts with the mousedown default
    // action; suppressing it (capture phase, the primary-button press
    // inside the editor — the mousedown of the session's own pointerdown,
    // which Chromium does not tag with a pointerId) leaves the editor as
    // the selection's sole writer. The multi-click check stands on the
    // mousedown's own detail (a synthetic pointer stands 0 detail on the
    // pointer events while the mouse events carry the real count): the
    // double/triple press is the browser's native word/paragraph select,
    // so the session is torn down and the default action stands.
    const mousedown = (event: MouseEvent) => {
      const session = sessionRef.current;
      const root = rootRef.current;
      if (session === null || root === null || event.button !== 0) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target === null || !root.contains(target)) return;
      if (event.detail >= 2) {
        sessionRef.current = null;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
        window.removeEventListener("mousedown", mousedown, true);
        return;
      }
      event.preventDefault();
    };
    handlersRef.current = { move, end, mousedown };
  }

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const root = rootRef.current;
      if (root === null || event.pointerType !== "mouse") return;
      // A multi-click (the word/line select of a double or triple click)
      // keeps the browser's default behavior — decided on the mousedown's
      // detail, which stands correctly while the pointer's stands 0 under
      // synthetic input (the session may stand here and is torn down by
      // the mousedown handler).
      if (event.detail >= 2) return;
      const target = event.target instanceof Element ? event.target : null;
      // A text inner of THIS editor (a nested editor's inner is handled by
      // that editor's own session).
      if (target?.closest('[data-slot="docblocks/editor"]') !== root) return;
      // The page miniature (the canvas view): the card's two-click contract
      // owns the presses over its content — the session's release would
      // plant a DOM caret over a press the canvas view consumed (the
      // first-click select). The miniature's text selection is the
      // browser's native gesture (the second press keeps the plain press).
      if (target.closest('[data-slot="docblocks/page-card"]') !== null) return;
      const inner = target.closest<HTMLElement>('[data-slot="docblocks/block-content"]');
      if (inner === null) return;
      const anchor = positionAtPoint(doc, root, event.clientX, event.clientY);
      if (anchor === null) return;
      sessionRef.current = { pointerId: event.pointerId, anchor, moved: false, last: null };
      const handlers = handlersRef.current;
      if (handlers === null) return;
      window.addEventListener("pointermove", handlers.move);
      window.addEventListener("pointerup", handlers.end);
      window.addEventListener("pointercancel", handlers.end);
      window.addEventListener("mousedown", handlers.mousedown, true);
    },
    [doc, rootRef]
  );

  // A session that outlives its pointer (the window closed over a
  // captured pointer) is torn down with the effect's cleanup.
  useEffect(() => {
    const triple = (event: MouseEvent) => {
      const root = rootRef.current;
      if (root === null || event.button !== 0 || event.detail < 3) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target === null || !root.contains(target)) return;
      const inner = target.closest<HTMLElement>('[data-slot="docblocks/block-content"]');
      if (inner === null || inner.closest('[data-slot="docblocks/editor"]') !== root) return;
      const blockId = inner.dataset.blockId as BlockId;
      // The native triple press selects the visual line of a pre-wrap
      // block (one soft-break line); the whole-block select is the
      // editor's: suppress the default action and stand the selection
      // over the block's whole text (all the soft-break lines).
      const head = locatePosition(inner, 0);
      const tail = locatePosition(inner, doc.getTextLength(blockId));
      event.preventDefault();
      window.getSelection()?.setBaseAndExtent(head.node, head.offset, tail.node, tail.offset);
    };
    window.addEventListener("mousedown", triple, true);
    return () => {
      window.removeEventListener("mousedown", triple, true);
      if (sessionRef.current === null) return;
      sessionRef.current = null;
      const handlers = handlersRef.current;
      if (handlers === null) return;
      window.removeEventListener("pointermove", handlers.move);
      window.removeEventListener("pointerup", handlers.end);
      window.removeEventListener("pointercancel", handlers.end);
      window.removeEventListener("mousedown", handlers.mousedown, true);
    };
  }, []);

  return { onPointerDown };
}

export { useCrossDrag };
