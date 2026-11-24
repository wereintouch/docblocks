/** The editor-level link popover's wiring: the popover's / the context
 * menu's state, the opener's api (the toolbar's button / the mod+k's
 * shortcut / the context menu's edit's item open over it — the target's
 * resolution + the uniform link's prefill), and the root's `contextmenu`'s
 * handler (the link's anchor's stand — the native menu's suppress over the
 * link's own menu; the other's targets stand the native's stand). */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, RefObject } from "react";

import type { Doc, Selection } from "docblocks-core";

import { useEditorContext } from "../../editor-provider";
import { caretOffsetIn } from "../dom-offset";
import { RESEAT_WINDOW_MS } from "../editor-root/history-reseat";
import { toolbarRangeOf } from "../format-range";
import type { ToolbarRange } from "../format-range";
import { openLinkHref } from "../link-open";
import { blockInnerOf } from "../phrase";
import { LinkMenu } from "./LinkMenu";
import { LinkPopover } from "./LinkPopover";
import { removeLink } from "./actions";
import type { LinkMenuState, LinkPopoverApi, LinkPopoverHandle, LinkPopoverOpen, LinkPopoverState } from "./models";
import { linkTargetOfCaret, uniformLinkHrefOf } from "./range";

/** The selection's rect's bottom to the popover's anchor's gap (px). */
const ANCHOR_GAP_PX = 8;

/** The selection's reseat's window (the tracking's transient mapping's
 * suppression over the popover / the menu's open's input's focus and the
 * close's residue — the doc's selection's no-clobber's stand). */
const LINK_RESEAT_WINDOW_MS = RESEAT_WINDOW_MS;

/** The anchor element's non-empty text descendants (in document order). */
function textNodesOf(anchor: Element): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(anchor, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current !== null) {
    if (current instanceof Text && current.nodeValue !== "") nodes.push(current);
    current = walker.nextNode();
  }
  return nodes;
}

/** The target's resolution over the view's selection (the toolbar's / the
 * mod+k's stand): the range over the eligible's target, the caret's link's
 * expansion over a caret (the inside-a-link's stand, the caret's own
 * insertion's target otherwise). */
function targetOfSelection(doc: Doc, selection: Selection | null): ToolbarRange | null {
  if (selection === null || selection.kind !== "text") return null;
  if (selection.to !== null) return toolbarRangeOf(doc, selection);
  return linkTargetOfCaret(doc, selection.from);
}

function useLinkPopover(rootRef: RefObject<HTMLElement | null>): LinkPopoverHandle {
  const { doc, selection: selectionRef, viewMode } = useEditorContext();
  const [popover, setPopover] = useState<LinkPopoverState | null>(null);
  const [menu, setMenu] = useState<LinkMenuState | null>(null);

  const suppressTransientSelection = () => {
    // The popover's / the menu's open's input's focus takes the DOM's
    // selection with it (the mapping's none's residue would clear the doc's
    // view — the window's suppression's stand over it, the undo's reseat's
    // parity). The close's residue (the input's removal's selection's
    // collapse) stands over the same window.
    selectionRef.reseatUntil.current = Date.now() + LINK_RESEAT_WINDOW_MS;
  };

  // The close's focus park: the popover's / the menu's input's removal
  // leaves the body focused, and the next gesture's keys (mod+k, typing)
  // would miss the root's handlers. The park stands the commit's effect —
  // a frame's deferral leaves the keys on the body for a whole frame, and
  // a fast next key is lost under load.
  const parkFocusRef = useRef(false);
  const closeAll = useCallback(() => {
    setPopover(null);
    setMenu(null);
    suppressTransientSelection();
    parkFocusRef.current = true;
  }, [rootRef, selectionRef]);

  // The close over a foreign focus owner (the caller's view switch): the
  // surfaces drop, nothing else. The park and the reseat window belong to
  // the editor's own close (the input's unmount's focus/selection
  // residue): a view switch unmounts the page itself, and the window would
  // suppress the NEXT view's selection mapping for its length (the
  // canvas-text's edit session's caret never reached the store, so its
  // Escape took the blocks-selection branch).
  const dismiss = useCallback(() => {
    setPopover(null);
    setMenu(null);
  }, []);

  useEffect(() => {
    if (!parkFocusRef.current) return;
    parkFocusRef.current = false;
    const active = document.activeElement;
    if (active === null || active === document.body) rootRef.current?.focus();
  });

  const open = useCallback(
    (anchor: { x: number; y: number }, opts?: LinkPopoverOpen): void => {
      setMenu(null);
      const view = selectionRef.view;
      const target = opts?.target ?? targetOfSelection(doc, view !== null ? view.get() : null);
      if (target === null) return;
      const prefilledHref = opts?.prefilledHref ?? uniformLinkHrefOf(doc, target);
      setPopover({ anchor, target, prefilledHref });
      suppressTransientSelection();
    },
    [doc, selectionRef]
  );

  const openFromSelection = useCallback(
    (selection: Selection | null): void => {
      const target = targetOfSelection(doc, selection);
      if (target === null) return;
      const root = rootRef.current;
      let anchor = { x: 8, y: 8 };
      const domSelection = window.getSelection();
      const range = domSelection !== null && domSelection.rangeCount > 0 ? domSelection.getRangeAt(0) : null;
      if (root !== null && range !== null && typeof range.getBoundingClientRect === "function") {
        const rect = range.getBoundingClientRect();
        const rootRect = root.getBoundingClientRect();
        anchor = { x: rect.left + rect.width / 2 - rootRect.left, y: rect.bottom - rootRect.top + ANCHOR_GAP_PX };
      }
      open(anchor, { target });
    },
    [doc, open, rootRef]
  );

  const api = useMemo<LinkPopoverApi>(() => ({ open, openFromSelection }), [open, openFromSelection]);

  /** The mod+k's interception (the read-only's / the nested editor's /
   * the form control's stands pass through): the popover's open over the
   * current view's selection, the no-op's stand over a non-text's view. */
  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>): boolean => {
      if (viewMode) return false;
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.shiftKey || event.key.toLowerCase() !== "k") return false;
      const target = event.target instanceof Element ? event.target : null;
      // The form control's keys (the popover's input's stand — the
      // re-open over it would reset the entered value; the other's inputs'
      // keys stand their own stand).
      if (target !== null && target.closest("input, textarea") !== null) return false;
      const root = rootRef.current;
      // A portaled editable outside the root (the foreign's form's stand —
      // the undo's guard's parity over the `useEditing`'s).
      const formControl = target?.closest("[contenteditable='true']") ?? null;
      if (root !== null && target !== null && formControl !== null && !root.contains(target)) return false;
      // A key over the nested editor (a sync-embed): that editor's own
      // hotkeys stand the gesture (the double-fire's off).
      const nearest = target?.closest('[data-slot="docblocks/editor"]') ?? null;
      if (root !== null && nearest !== null && nearest !== root) return false;
      event.preventDefault();
      const view = selectionRef.view;
      openFromSelection(view !== null ? view.get() : null);
      return true;
    },
    [viewMode, rootRef, selectionRef, openFromSelection]
  );

  /** The root's contextmenu: over the link's anchor — the link's menu (the
   * native's suppress); otherwise — the native's stand (the table's cell's
   * menu / the browser's own stand over the other's targets). */
  const onContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>): void => {
      const targetEl = event.target instanceof Element ? event.target : null;
      const anchorEl = targetEl?.closest("a[data-slot='docblocks/link']") ?? null;
      const root = rootRef.current;
      if (anchorEl === null || root === null) return;
      const href = anchorEl.getAttribute("href");
      const blockId = anchorEl.closest<HTMLElement>("[data-block-id]")?.dataset.blockId;
      if (href === null || blockId === undefined) return;
      const inner = blockInnerOf(rootRef, blockId);
      const nodes = inner !== null ? textNodesOf(anchorEl) : [];
      if (inner === null || nodes.length === 0) return;
      const from = caretOffsetIn(inner, nodes[0]!, 0);
      const last = nodes[nodes.length - 1]!;
      const to = caretOffsetIn(inner, last, last.nodeValue?.length ?? 0);
      if (from >= to) return; // the degenerate's stand (the no-text's anchor)
      event.preventDefault();
      setPopover(null);
      setMenu({ x: event.clientX, y: event.clientY, href, blockId, from, to });
    },
    [rootRef]
  );

  const handleOpen = useCallback(() => {
    if (menu !== null) {
      openLinkHref(menu.href);
      closeAll();
    }
  }, [closeAll, menu]);

  const handleCopy = useCallback(() => {
    if (menu === null) return;
    try {
      void navigator.clipboard.writeText(menu.href);
    } catch {
      // The page may not hold the write (permissions) — the no-op's stand
      // (the table's cell's menu's parity).
    }
    closeAll();
  }, [closeAll, menu]);

  const handleEdit = useCallback(() => {
    if (menu === null) return;
    const root = rootRef.current;
    if (root === null) return;
    const rootRect = root.getBoundingClientRect();
    // The open's stand over the close (the popover's input's focus takes
    // the focus — the no-refocus's stand over the edit's transition).
    open(
      { x: menu.x - rootRect.left, y: menu.y - rootRect.top },
      {
        target: { kind: "single", blockId: menu.blockId, from: menu.from, to: menu.to },
        prefilledHref: menu.href,
      }
    );
  }, [menu, open, rootRef]);

  const handleRemove = useCallback(() => {
    if (menu === null) return;
    removeLink(doc, { kind: "single", blockId: menu.blockId, from: menu.from, to: menu.to });
    closeAll();
  }, [closeAll, doc, menu]);

  const node = (
    <>
      {menu !== null && (
        <LinkMenu
          menu={menu}
          viewMode={viewMode}
          onOpen={handleOpen}
          onCopy={handleCopy}
          onEdit={handleEdit}
          onRemove={handleRemove}
          onClose={closeAll}
        />
      )}
      {popover !== null && <LinkPopover rootRef={rootRef} state={popover} onClose={closeAll} />}
    </>
  );

  return { api, handleKeyDown, onContextMenu, node, close: dismiss };
}

export { useLinkPopover };
