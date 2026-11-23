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

import { containerCaretNeedsReseat, reseatContainerCaret, surfaceInnerOf } from "./page-surface-dom";

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

export { PageSurfaceProvider, usePageSurface, usePageSurfaceDispatch };
export {
  containerCaretNeedsReseat,
  isPageSurfaceInner,
  parkEditorFocus,
  reseatContainerCaret,
  surfaceInnerOf,
} from "./page-surface-dom";
export type { PageSurfaceHandlers, PageSurfaceHandlersMap, PageSurfaceRegistry };
/** The editor instance's surface handlers map (the dispatch + the registry's shared source). */
type PageSurfaceHandlersMap = Map<BlockId, PageSurfaceHandlers>;
