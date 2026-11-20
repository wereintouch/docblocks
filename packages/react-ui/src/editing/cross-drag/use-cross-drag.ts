/**
 * The text selection by mouse drag, in-block and across block boundaries:
 * the browser cannot extend a selection across a contenteditable boundary
 * (neither a drag nor a native shift+arrow), and its own drag session
 * would re-assert its (in-block-only) selection after the editor's, so
 * while a session is active the editor is the selection's sole writer —
 * the session's mousedown default action is suppressed (that is what
 * starts the browser's drag session; the caret seat and the focus move
 * with it, so both are stood up by the editor at the session end) and
 * the selection is seated from the pointer position on every move.
 *
 * The page flow's mousedown guard and the triple press's whole-block
 * select stand over the edit's mode. The read-only
 * stand (`readOnly`): no session starts and both capture listeners stand
 * off — the view mode's native range IS the copy's affordance (the
 * browser's selection gesture must own the presses; the guard's default's
 * suppression would kill it).
 */
import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent, RefObject } from "react";

import type { Doc } from "docblocks-core";

import type { CrossDragHandlers, CrossDragSession } from "./models";
import { usePageMousedownGuard, useTripleSelect } from "./page-guards";
import { positionAtPoint } from "./position";
import { createSessionHandlers, teardownSession } from "./session";

/** The root's cross-drag handlers (the pointerdown starts the session). */
function useCrossDrag(rootRef: RefObject<HTMLElement | null>, doc: Doc, readOnly = false) {
  const sessionRef = useRef<CrossDragSession | null>(null);
  const handlersRef = useRef<CrossDragHandlers | null>(null);
  if (handlersRef.current === null) handlersRef.current = createSessionHandlers(doc, rootRef, sessionRef);

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
      // The press over a non-editable island's own surface (the mention
      // chip, an image's figure, the table's chrome): the island owns the
      // press — a caret session would seat the selection on the chip's
      // line and pull the scroll port there (the click's point stands
      // elsewhere). A self-contained editable inside the island (a table
      // cell's inner, the activation layer) keeps its session.
      const island = target.closest('[contenteditable="false"]');
      const editable = target.closest('[contenteditable="true"]');
      if (island !== null && (editable === null || !island.contains(editable))) return;
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

  usePageMousedownGuard(rootRef, readOnly);
  useTripleSelect(rootRef, doc, readOnly);

  // A session that outlives its pointer (the window closed over a
  // captured pointer) is torn down with the effect's cleanup.
  useEffect(
    () => () => {
      if (sessionRef.current === null) return;
      sessionRef.current = null;
      const handlers = handlersRef.current;
      if (handlers === null) return;
      teardownSession(handlers);
    },
    []
  );

  return { onPointerDown };
}

export { useCrossDrag };
