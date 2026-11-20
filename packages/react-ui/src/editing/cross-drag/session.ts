/** The cross-drag session's window listeners: the pointermove's seat, the
 *  pointerup's seat restore + focus recovery, and the capture-phase
 *  mousedown that keeps the editor the selection's sole writer. */
import type { RefObject } from "react";

import type { Doc } from "docblocks-core";

import type { CrossDragHandlers, CrossDragSession } from "./models";
import { positionAtPoint, seatCrossSelection } from "./position";

/** Tear the session's listeners down (the session ends, the pointer frees). */
function teardownSession(handlers: CrossDragHandlers): void {
  window.removeEventListener("pointermove", handlers.move);
  window.removeEventListener("pointerup", handlers.end);
  window.removeEventListener("pointercancel", handlers.end);
  window.removeEventListener("mousedown", handlers.mousedown, true);
}

/**
 * The session's listeners, built once for the hook's lifetime (they read
 * everything through refs, so a session that spans re-renders keeps the
 * very listeners it registered).
 *
 * The selection is seated from the pointer position on every move. The
 * anchor stands at the pointer position of the pointerdown (the
 * pointerdown fires before the browser would seat its caret, so the DOM
 * selection is not read), and the focus end follows the pointer through
 * the other blocks (the selectionchange mapping then keeps the view
 * selection in sync, per block). The session ends on pointerup/cancel: a
 * click without a drag re-seats the caret at the anchor (the plain click
 * behavior), a drag leaves the selection where the pointer left it.
 *
 * The browser's selection drag starts with the mousedown default action;
 * suppressing it (capture phase, the primary-button press inside the
 * editor — the mousedown of the session's own pointerdown, which Chromium
 * does not tag with a pointerId) leaves the editor the selection's sole
 * writer. The multi-click check stands on the mousedown's own detail (a
 * synthetic pointer stands 0 detail on the pointer events while the mouse
 * events carry the real count): the double press is the browser's native
 * word select, the shift's press the native extension's stand, and the
 * press over a focused iframe the browser's focus move — the session tears
 * down and the default action stands for all three.
 */
function createSessionHandlers(
  doc: Doc,
  rootRef: RefObject<HTMLElement | null>,
  sessionRef: RefObject<CrossDragSession | null>
): CrossDragHandlers {
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
    const seat = () => {
      if (session.moved && session.last !== null) seatCrossSelection(session.anchor, session.last);
      else
        window
          .getSelection()
          ?.setBaseAndExtent(session.anchor.node, session.anchor.offset, session.anchor.node, session.anchor.offset);
    };
    seat();
    // The focus's recovery (the span model): the suppressed mousedown's
    // default dropped the browser's focus move (a plain press over the
    // inner leaves the document's focus where it stood, and the keys
    // would land outside the editor). The seat's editable takes the
    // focus (the inner over a text's seat, the container over a gap's);
    // the focus move collapses the DOM selection to the editable's
    // start, so the seat is re-established over it.
    const seatNode = window.getSelection()?.anchorNode ?? session.anchor.node;
    const seatElement = seatNode instanceof Element ? seatNode : (seatNode.parentElement ?? null);
    const editable = seatElement?.closest<HTMLElement>('[contenteditable="true"]') ?? null;
    if (editable !== null && document.activeElement !== editable) {
      editable.focus();
      seat();
    }
    teardownSession({ move, end, mousedown });
  };
  const mousedown = (event: MouseEvent) => {
    const session = sessionRef.current;
    const root = rootRef.current;
    if (session === null || root === null || event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target === null || !root.contains(target)) return;
    const tearDown = () => {
      sessionRef.current = null;
      teardownSession({ move, end, mousedown });
    };
    // The multi-click: the browser's native word/paragraph select.
    if (event.detail >= 2) {
      tearDown();
      return;
    }
    // The shift's press (the shift+click's selection's extension): the
    // extension runs over the mousedown's default (the browser extends
    // the selection from the anchor to the press's position — the native
    // gesture stands over the nested editables), so the default's
    // suppression is off: the session tears down and the browser's
    // extension + the focus's move stand (the mapping's view sync over
    // the selectionchange). The suppression's stand would kill the
    // extension and seat a plain caret (the session's click's stand)
    // instead — the selection's loss.
    if (event.shiftKey) {
      tearDown();
      return;
    }
    // The iframe holds the document's focus (the press stands over the
    // editor, the focus stands in a frame): the mousedown's default
    // action is the browser's focus move out of the frame — suppressing
    // it would leave the editor's document unfocused (the session's
    // caret's seat stands over the unfocused document: no visible caret,
    // the keys' no-stand). The browser's native caret's seat the press,
    // so the session's torn down (the unsuppressed mousedown starts the
    // browser's own selection drag, which the editor's cross seat would
    // fight).
    if (document.activeElement instanceof HTMLIFrameElement) {
      tearDown();
      return;
    }
    event.preventDefault();
  };
  return { move, end, mousedown };
}

export { createSessionHandlers, teardownSession };
