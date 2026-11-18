/** The canvas viewport's owner hook: the per-view store (the viewport's
 * render slices + the stable gesture commands) + the browser's
 * persistence (the zoom / pan's debounced write + the unmount's flush).
 * The returned object stands the viewport's live state + the commands
 * (the gesture hooks read the values over the fresh object, the commands
 * over the stable closures) + the store (the context's value — the
 * heavy children's narrow subscriptions). Pure view state per editor
 * instance — it stands outside the doc and the awareness and resets on
 * the canvas view's unmount. */
import { useStore } from "zustand";

import { useEffect, useMemo, useRef } from "react";

import type { Doc } from "docblocks-core";

import { createCanvasViewportCommands } from "./commands";
import { marqueeRect } from "./geometry";
import type { CanvasViewportState } from "./models";
import { WRITE_DEBOUNCE_MS, writeCanvasViewport } from "./persistence";
import type { PersistedViewport } from "./persistence";
import { unitMembers } from "./session-shape";
import { type CanvasViewportStore, createViewportStore } from "./viewport-store";

function useCanvasViewport(
  doc: Doc,
  initialViewport?: PersistedViewport | null
): CanvasViewportState & { store: CanvasViewportStore } {
  // The viewport's stand: the restored browser state (the storage's read)
  // over the 100% / center's default. The store stands once per canvas
  // view (the view-mode's unmount resets it).
  // The initial viewport stands over the first render's read; the store's
  // identity must not re-seed on the doc's change (the viewport's state is
  // the view's own — the view-mode's unmount stands the reset).
  const store = useMemo(
    () => createViewportStore({ zoom: initialViewport?.zoom ?? 1, pan: initialViewport?.pan ?? { x: 0, y: 0 } }),
    []
  );
  const commands = useMemo(() => createCanvasViewportCommands(store, doc), [store, doc]);
  // The body's subscription: the WHOLE state (the re-render is a shallow
  // JSX evaluation — the memoized children stand their subscriptions).
  const state = useStore(store, (s) => s);

  // The viewport's browser persistence: the zoom / pan's commit over the
  // debounced write (the wheel's / the pan's / the fit's last stand
  // coalesces over the trailing edge) + the unmount's flush (the
  // leave-within-the-window's last change stands committed). The doc's
  // own data stands untouched.
  const { zoom, pan } = state;
  const persistedRef = useRef({ docId: doc.meta.id, zoom, pan });
  persistedRef.current = { docId: doc.meta.id, zoom, pan };
  useEffect(() => {
    const handle = setTimeout(() => writeCanvasViewport(doc.meta.id, { zoom, pan }), WRITE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [doc, zoom, pan]);
  useEffect(() => {
    return () => {
      const latest = persistedRef.current;
      writeCanvasViewport(latest.docId, { zoom: latest.zoom, pan: latest.pan });
    };
  }, [doc]);

  return {
    ...state,
    ...commands,
    store,
    marqueeRect: state.marquee === null ? null : marqueeRect(state.marquee.start, state.marquee.end),
  };
}

export { unitMembers, useCanvasViewport };
