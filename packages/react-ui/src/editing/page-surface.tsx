/**
 * The page surface's input dispatch over the single page editable.
 *
 * The page container is one contenteditable (edit mode): the native DOM
 * selection crosses the blocks' boundaries natively (the highlight is
 * continuous in every engine — the WebKit family's cross-editable
 * clamp only applies between SIBLING editables, and the blocks are
 * nested inside the shared editable region). The price: every
 * keyboard/input event of the page surface targets the container (the
 * focused element), never a block's inner — the per-block handlers
 * (the input gestures, the commit) are registered per block in the
 * surface registry and dispatched from the container's handlers over
 * the block the live DOM selection's anchor stands in.
 *
 * The isolated surfaces (the table's and the database's cells, the
 * sync-embed's nested editor) sit behind a contenteditable="false"
 * boundary: the browser focuses their own inner there, so their keys
 * and inputs target themselves (their own handlers stand) and never
 * reach this dispatcher (its handlers stand only for events targeted
 * at the container).
 */
import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import type {
  ClipboardEvent as ReactClipboardEvent,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  SyntheticEvent as ReactSyntheticEvent,
  RefObject,
} from "react";

import type { BlockId, Doc } from "docblocks-core";

import { focusCaretIn } from "./block-commands";

/** The one inner-scoped handler set the surface registry holds per block. */
interface PageSurfaceHandlers {
  onKeydown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  onInput: () => void;
  onPaste: (event: ReactClipboardEvent<HTMLElement>) => void;
}

interface PageSurfaceRegistry {
  handlers: Map<BlockId, PageSurfaceHandlers>;
  register: (id: BlockId, handlers: PageSurfaceHandlers) => void;
  unregister: (id: BlockId) => void;
}

const PageSurfaceContext = createContext<PageSurfaceRegistry | null>(null);

/**
 * The page surface's registry provider: one handlers map per editor
 * instance (the sync-embed's nested editor stands its own instance over
 * its own subtree). The map is created by the editor component (its
 * dispatch binding reads the same map directly — the dispatch hook runs
 * OUTSIDE the provider's subtree, so a context read there would stand
 * the default null) and is identity-stable over the instance's
 * lifetime; the entries update in place.
 */
function PageSurfaceProvider({
  map,
  children,
}: {
  map: Map<BlockId, PageSurfaceHandlers>;
  children: ReactNode;
}): ReactNode {
  const registry = useMemo<PageSurfaceRegistry>(
    () => ({
      handlers: map,
      register: (id, handlers) => {
        map.set(id, handlers);
      },
      unregister: (id) => {
        map.delete(id);
      },
    }),
    [map]
  );
  return <PageSurfaceContext.Provider value={registry}>{children}</PageSurfaceContext.Provider>;
}

/** The current editor instance's surface registry (null outside the provider). */
function usePageSurface(): PageSurfaceRegistry | null {
  return useContext(PageSurfaceContext);
}

/**
 * Whether the inner is a PAGE-SURFACE text block of its own editor scope:
 * not inside a contenteditable="false" island of the same scope (the
 * island's cells stand their own focused inner). An island OUTSIDE the
 * inner's editor root (the sync-embed's wrapper around the nested
 * editor) is not a boundary for that scope.
 */
function isPageSurfaceInner(inner: HTMLElement): boolean {
  const island = inner.closest('[contenteditable="false"]');
  if (island === null) return true;
  const scope = inner.closest('[data-slot="docblocks/editor"]');
  return scope === null || scope.contains(island) === false;
}

/**
 * The page-surface inner (if any) that contains the selection's anchor:
 * the dispatch target over the container-targeted event.
 */
function surfaceInnerOf(container: HTMLElement, anchorNode: Node | null): HTMLElement | null {
  if (anchorNode === null) return null;
  const host = anchorNode.nodeType === Node.ELEMENT_NODE ? (anchorNode as Element) : (anchorNode.parentElement ?? null);
  const inner = host?.closest<HTMLElement>('[data-slot="docblocks/block-content"]') ?? null;
  if (inner === null || !container.contains(inner) || isPageSurfaceInner(inner) === false) return null;
  return inner;
}

/**
 * The page-surface inners of one container in DOM order (the reseat's
 * candidates).
 */
function surfaceInnersOf(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-slot="docblocks/block-content"]')).filter((inner) =>
    isPageSurfaceInner(inner)
  );
}

/**
 * Re-seat a caret stranded at a pure page-container position (between
 * the block rows — the transient the browser's auto-seat leaves over
 * some gesture paths) into the nearest block's edge: the preceding
 * block's end or the following block's start, by the vertical distance
 * (the caret's y over the range's rect, the gap's midline when the
 * rect is degenerate). One DOM selection write (the next
 * selectionchange's mapping reads the seated caret).
 */
function reseatContainerCaret(container: HTMLElement, scope: ParentNode, doc: Doc): void {
  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0 || !selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  if (surfaceInnerOf(container, range.startContainer) !== null) return; // already inside a block
  const inners = surfaceInnersOf(container);
  let previous: HTMLElement | null = null;
  let following: HTMLElement | null = null;
  // The order over the anchor's own position (the compareDocumentPosition
  // flags stand the containment over a container's anchor, whose children
  // are all "following" descendants): the inner's start boundary versus
  // the caret's point.
  for (const inner of inners) {
    const innerStart = document.createRange();
    innerStart.setStart(inner, 0);
    innerStart.collapse(true);
    if (range.compareBoundaryPoints(Range.END_TO_START, innerStart) === -1) {
      if (following === null) following = inner;
    } else if (previous === null || previous !== inner) {
      previous = inner;
    }
  }
  if (previous === null && following === null) return;

  let caretY: number | null = null;
  const caretRect = range.getBoundingClientRect();
  if (caretRect.height > 0) {
    caretY = caretRect.top + caretRect.height / 2;
  } else if (previous !== null && following !== null) {
    const previousBottom = previous.getBoundingClientRect().bottom;
    const followingTop = following.getBoundingClientRect().top;
    caretY = (previousBottom + followingTop) / 2;
  }

  // The nearer edge wins (the document-order end / start by default when
  // the caret's y is not measurable).
  let target: HTMLElement | null = previous;
  if (previous !== null && following !== null && caretY !== null) {
    const previousBottom = previous.getBoundingClientRect().bottom;
    const followingTop = following.getBoundingClientRect().top;
    if (Math.abs(followingTop - caretY) < Math.abs(caretY - previousBottom)) {
      target = following;
    }
  } else if (previous === null) {
    target = following;
  }
  if (target === null) return;
  // The seat offset: the preceding block's end over its doc text length
  // (the source of truth — the inner's DOM text may lag a remote change),
  // the following block's start.
  const targetId = target.dataset.blockId as BlockId;
  // The frame-time guard (the seat's validity stands at the frame, not at
  // the schedule): the re-seat's frame may outlive the transient (a
  // competing reseat — the undo/redo's history seat — or the user's own
  // gesture since the selectionchange). A selection that has since stood
  // in a block's inner / a form control / an isolated surface is no
  // longer the stranded container's caret: the edge seat would clobber
  // it (the history's pre-gesture seat over the remount's residue).
  focusCaretIn(targetId, target === previous ? doc.getTextLength(targetId) : 0, scope, () => {
    const anchor = window.getSelection()?.anchorNode ?? null;
    return containerCaretNeedsReseat(container, anchor);
  });
}

/**
 * Whether the caret's anchor sits in a pure page-container position that
 * needs the re-seat: inside the container's own editable flow (its
 * nearest contenteditable is the container) and not inside a page-surface
 * inner (a block's text inner is a valid caret seat, not a transient).
 */
function containerCaretNeedsReseat(container: HTMLElement, anchorNode: Node | null): boolean {
  if (anchorNode === null || container.contains(anchorNode) === false) return false;
  const host = anchorNode.nodeType === Node.ELEMENT_NODE ? (anchorNode as Element) : (anchorNode.parentElement ?? null);
  // A form control's focus (the code caption's input, the hex's field) is
  // a genuine landing: the controls live inside the container but own
  // their own caret.
  if (host?.matches("input, textarea") === true) return false;
  // A collapsed selection inside an isolated surface (a
  // contenteditable=false island: the database grid's cells, the table's
  // chrome) is that island's own pointer state (the grid's cell selection,
  // the edit session's open): the reseat must not steal it into the page
  // text — the steal takes the island's focus with it (the grid's cell
  // input blurs, its session commits and closes over the press).
  if (host?.closest('[contenteditable="false"]') !== null) return false;
  const editable = host?.closest<HTMLElement>('[contenteditable="true"]') ?? null;
  if (editable !== container) return false;
  return surfaceInnerOf(container, anchorNode) === null;
}

interface PageSurfaceHandlersBinding {
  /** Attach to the page container element. */
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  /** Attach to the page container element. */
  onInput: (event: ReactSyntheticEvent<HTMLElement>) => void;
  /** Attach to the page container element. */
  onPaste: (event: ReactClipboardEvent<HTMLElement>) => void;
}

/**
 * The container-level dispatch of the page surface's per-block handlers
 * + the container-caret's guard: a beforeinput targeted at the container
 * itself (the input over a pure container position — the chromium's
 * bare-div's materialization) is suppressed and the caret re-seats into
 * the nearest block's edge.
 */
function usePageSurfaceDispatch(
  containerRef: RefObject<HTMLDivElement | null>,
  doc: Doc,
  handlers: Map<BlockId, PageSurfaceHandlers>
): PageSurfaceHandlersBinding {
  const dispatch = useCallback(
    (event: { target: EventTarget | null }, kind: "keydown" | "paste" | "input") => {
      const container = containerRef.current;
      if (container === null || event.target !== container) return;
      const selection = window.getSelection();
      const inner = surfaceInnerOf(container, selection?.anchorNode ?? null);
      if (inner === null) return; // a container-caret key: the browser / the guard own it
      const blockHandlers = handlers.get(inner.dataset.blockId as BlockId);
      if (blockHandlers === undefined) return;
      if (kind === "keydown") blockHandlers.onKeydown(event as unknown as ReactKeyboardEvent<HTMLElement>);
      else if (kind === "paste") blockHandlers.onPaste(event as unknown as ReactClipboardEvent<HTMLElement>);
      else blockHandlers.onInput();
    },
    [containerRef, handlers]
  );

  // The container-position's input guard (a native beforeinput over the
  // container: the input stands after the browser's mutation, so the
  // suppression has to precede it).
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const onBeforeInput = (event: InputEvent): void => {
      if (event.target !== container) return;
      // Suppress only over a pure container position (a caret inside a
      // block's inner is a valid seat — the input proceeds as is).
      const selection = window.getSelection();
      if (containerCaretNeedsReseat(container, selection?.anchorNode ?? null) === false) return;
      event.preventDefault();
      const scope = container.closest<HTMLElement>('[data-slot="docblocks/editor"]') ?? document;
      reseatContainerCaret(container, scope, doc);
    };
    container.addEventListener("beforeinput", onBeforeInput);
    return () => container.removeEventListener("beforeinput", onBeforeInput);
  }, [containerRef, doc]);

  return useMemo(
    () => ({
      onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
        dispatch(event, "keydown");
      },
      onInput: (event: ReactSyntheticEvent<HTMLElement>) => {
        dispatch(event, "input");
      },
      onPaste: (event: ReactClipboardEvent<HTMLElement>) => {
        dispatch(event, "paste");
      },
    }),
    [dispatch]
  );
}

/**
 * Park the editor root's focus over the anchor's editor instance: the
 * selection keys' reach when the focus stands outside the editor (the
 * gutter's click, the drag's release). A focus already inside the editor
 * stands as is (no selection change, the keys bubble from it to the root).
 */
function parkEditorFocus(anchor: HTMLElement): void {
  const root = anchor.closest<HTMLElement>('[data-slot="docblocks/editor"]');
  if (root === null) return;
  const active = document.activeElement;
  if (active !== null && root.contains(active)) return;
  root.focus();
}

export {
  PageSurfaceProvider,
  containerCaretNeedsReseat,
  isPageSurfaceInner,
  parkEditorFocus,
  reseatContainerCaret,
  surfaceInnerOf,
  usePageSurface,
  usePageSurfaceDispatch,
};
export type { PageSurfaceHandlers, PageSurfaceRegistry };
/** The editor instance's surface handlers map (the dispatch + the registry's shared source). */
export type PageSurfaceHandlersMap = Map<BlockId, PageSurfaceHandlers>;
