import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";

/**
 * The canvas shape's inline text-edit session (pure view state — the doc
 * and the awareness stand untouched until the edit's commit): which
 * shape (if any) is in the double-click's inline text edit. The
 * toolbar's add-text button and the shape's double-click open it; the
 * edit's blur / the Escape close it. The value stands the canvas
 * viewport's state (the single source, the canvas view's unmount resets
 * it with the rest of the viewport state); the context is the delivery
 * (the canvas root's provider over the surfaces and the floating
 * chrome).
 */
interface CanvasTextEdit {
  /** The shape in the inline edit (the id); null outside an edit. */
  editingId: string | null;
  /** Opens (the id) / closes (null) the inline edit. */
  setEditingId: (id: string | null) => void;
}

const CanvasTextEditContext = createContext<CanvasTextEdit | null>(null);

/**
 * The edit session's access (the canvas view's provider). Null outside
 * the canvas view (the page view's inert surfaces render the shape's
 * text read-only — the dblclick's edit stands the canvas's session,
 * which exists only while the canvas view is mounted).
 */
function useCanvasTextEdit(): CanvasTextEdit | null {
  return useContext(CanvasTextEditContext);
}

function CanvasTextEditProvider({
  editingId,
  setEditingId,
  children,
}: {
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  children: ReactNode;
}) {
  // The value stands stable over the session's idle renders: a fresh
  // object per canvas render would re-render every consumer (the shapes'
  // text overlays) on the viewport's pointermoves.
  const value = useMemo(() => ({ editingId, setEditingId }), [editingId, setEditingId]);
  return <CanvasTextEditContext.Provider value={value}>{children}</CanvasTextEditContext.Provider>;
}

export { CanvasTextEditProvider, useCanvasTextEdit };
export type { CanvasTextEdit };
