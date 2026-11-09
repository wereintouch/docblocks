import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";

/**
 * The canvas's inline text-edit sessions (pure view state — the doc and
 * the awareness stand untouched until the edit's commit): which shape (if
 * any) is in the double-click's inline text edit, and which canvas-text
 * block (if any) is in its edit session (the double-click / the ghost's
 * commit — the inner is contentEditable ONLY while the session stands).
 * The toolbar's add-text button, the shape's double-click, and the
 * canvas-text's double-click open them; the edit's blur / the Escape
 * close them. The value stands the canvas viewport's state (the single
 * source, the canvas view's unmount resets it with the rest of the
 * viewport state); the context is the delivery (the canvas root's
 * provider over the surfaces and the floating chrome).
 */
interface CanvasTextEdit {
  /** The shape in the inline edit (the id); null outside an edit. */
  editingId: string | null;
  /** Opens (the id) / closes (null) the shape's inline edit. */
  setEditingId: (id: string | null) => void;
  /** The canvas-text block in the edit session (the id); null outside. */
  canvasTextEditingId: string | null;
  /** Opens (the id) / closes (null) the canvas-text's edit session. */
  setCanvasTextEditingId: (id: string | null) => void;
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
  canvasTextEditingId,
  setCanvasTextEditingId,
  children,
}: {
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  canvasTextEditingId: string | null;
  setCanvasTextEditingId: (id: string | null) => void;
  children: ReactNode;
}) {
  // The value stands stable over the session's idle renders: a fresh
  // object per canvas render would re-render every consumer (the shapes'
  // text overlays, the canvas-text's blocks) on the viewport's
  // pointermoves.
  const value = useMemo(
    () => ({ editingId, setEditingId, canvasTextEditingId, setCanvasTextEditingId }),
    [editingId, setEditingId, canvasTextEditingId, setCanvasTextEditingId]
  );
  return <CanvasTextEditContext.Provider value={value}>{children}</CanvasTextEditContext.Provider>;
}

export { CanvasTextEditProvider, useCanvasTextEdit };
export type { CanvasTextEdit };
