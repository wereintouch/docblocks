import { useCallback, useRef } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { linkHrefKindOf } from "docblocks-core";

import { openLinkHref } from "./link-open";

/**
 * The editor-level's link open (the contenteditable's anchor's gap): the
 * browser cancels the anchor's navigation default inside a contenteditable
 * (the caret's seat stands — the mousedown's default), so the editor opens
 * the href itself over the kind's stand (the `link-open`'s unit: the web's
 * URL stands the new tab's open, the `mailto` / `tel` / the relative's
 * forms stand the same-tab's navigation) over the edit and the view's
 * modes (the parity). The editor's state stands untouched (the caret's
 * seat and the focus are the mousedown's default's work — preserved). A
 * press-drag over the link (the selection's gesture) stands no open: the
 * open stands on the down/click point's distance only (a plain click).
 *
 * The stand runs over the editor root (the bubble — the anchors stand in
 * the block's content only; the portaled's UI stands outside the root,
 * the iframe's embed's clicks stand no parent's events). The mousedown's
 * resolution (the press's pointer capture's retargeting stands the
 * click's target over the canvas's container — the mousedown's target
 * stands the element's stand). The modified clicks (the ctrl / meta /
 * shift / alt) and the non-left's buttons stand the browser's native
 * stands (the middle-click's / the cmd-click's new tab).
 */

/** The plain-click's movement tolerance (the screen px — the gesture,
 * not the canvas's space): over it the press stands the selection's
 * drag, no open. */
const LINK_CLICK_DRAG_PX = 4;

/** The pressed link's record (the href over the safe gate + the press's
 * point, the plain-click's tolerance's measure over it). */
interface LinkPress {
  href: string;
  x: number;
  y: number;
}

/** The editor root's link-open's handlers (the mousedown's record + the
 * click's open over the plain press). */
function useLinkOpen(): {
  onMouseDown: (event: ReactMouseEvent<HTMLElement>) => void;
  onClick: (event: ReactMouseEvent<HTMLElement>) => void;
} {
  const pressRef = useRef<LinkPress | null>(null);

  const onMouseDown = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    // The modified / the non-left's press stands the browser's native
    // stand (the cmd-click's / the middle-click's new tab) — no record.
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      pressRef.current = null;
      return;
    }
    const target = event.target;
    const anchor = target instanceof Element ? (target.closest("a[href]") as HTMLAnchorElement | null) : null;
    const href = anchor !== null ? anchor.getAttribute("href") : null;
    // The gate's parity over the renderer (the `linkHrefOf`'s stand — the
    // unsafe scheme's text stands plain, never an anchor, so no record
    // stands over it either).
    pressRef.current =
      anchor !== null && href !== null && linkHrefKindOf(href) !== null
        ? { href, x: event.clientX, y: event.clientY }
        : null;
  }, []);

  const onClick = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    const press = pressRef.current;
    pressRef.current = null;
    if (press === null) return;
    const dx = event.clientX - press.x;
    const dy = event.clientY - press.y;
    if (dx * dx + dy * dy > LINK_CLICK_DRAG_PX * LINK_CLICK_DRAG_PX) return; // the drag's stand
    // The anchor's default's cancel (the view's mode's same-tab's
    // navigation — the edit's mode stands it canceled over the CE's
    // semantics already; the caret's seat is the mousedown's stand,
    // untouched). The open stands the kind's stand (the web's URL's new
    // tab, the other forms' same-tab's navigation).
    event.preventDefault();
    openLinkHref(press.href);
  }, []);

  return { onMouseDown, onClick };
}

export { useLinkOpen };
