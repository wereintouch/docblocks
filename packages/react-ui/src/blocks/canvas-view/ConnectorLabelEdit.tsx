/**
 * The connector's LABEL inline edit: the
 * line's double-click opens the input at the line's midpoint (the world's
 * space — the seat scales with the zoom, like the line). The double-click
 * over the text selects the whole label (the input's select-all — the
 * Backspace / the Delete clear the selection natively); the blur (the
 * outside click) / the Escape / the Enter commit (one `updateBlock` in
 * one transact — one undo step, one wire update), and the empty commit
 * stands the removed state (the attr stands the empty string). The chip
 * stands the existing background token over the 1px frame of the line's
 * own color (the selection's emphasis stands the frame too) and the
 * small corner rounding. Pure view state: the doc writes on the commit
 * only.
 */
import { useEffect, useRef } from "react";

import type { BlockId } from "docblocks-core";

import { useEditorContext } from "../../EditorProvider";

const LABEL_EDIT_WIDTH = 120;

function ConnectorLabelEdit({
  id,
  mid,
  stroke,
  label,
  onClose,
}: {
  id: BlockId;
  /** The line's midpoint (the surface's local space — the world's origin). */
  mid: { x: number; y: number };
  /** The line's effective stroke (the frame's color — the token or the data hex). */
  stroke: string;
  /** The committed label (the edit's seed — the double-click's select-all stands over it). */
  label: string;
  /** Closes the edit (the viewport's state). */
  onClose: () => void;
}) {
  const { doc } = useEditorContext();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const committedRef = useRef(false);

  // The focus on mount (the caret stands the draft; the double-click's
  // select-all is the input's own stand while editing).
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const commit = (value: string) => {
    if (committedRef.current) return;
    committedRef.current = true;
    onClose();
    const trimmed = value.trim();
    // The no-op stand (the value stands the committed label — the doc's
    // own read: the peer's concurrent edit is not clobbered) and the
    // concurrent removal (the gone block stands nothing).
    const block = doc.getBlock(id);
    const current = block !== null && block.type === "connector" ? (block.attrs?.label ?? "") : null;
    if (current === null || trimmed === current) return;
    doc.transact(() => {
      doc.updateBlock(id, { label: trimmed });
    });
  };

  return (
    <input
      ref={inputRef}
      type="text"
      data-slot="docblocks/connector-label-edit"
      aria-label="Connector label"
      defaultValue={label}
      style={{
        position: "absolute",
        left: `calc(50% + ${mid.x}px)`,
        top: `calc(50% + ${mid.y}px)`,
        transform: "translate(-50%, -50%)",
        width: LABEL_EDIT_WIDTH,
        boxSizing: "border-box",
        padding: "2px 6px",
        fontSize: 12,
        textAlign: "center",
        background: "var(--docblocks-page-card-background)",
        border: `1px solid ${stroke}`,
        borderRadius: "var(--docblocks-radius, 6px)",
        outline: "none",
      }}
      onDoubleClick={(event) => {
        // The double-click over the text selects the WHOLE label (the
        // input's word-select stands nothing — the select-all is the
        // stand: the Backspace / the Delete clear the selection). The
        // propagation stands off (the container's double-click's handler
        // keeps no target over the input — the edit's own stand only).
        event.stopPropagation();
        event.currentTarget.select();
      }}
      onBlur={(event) => commit(event.target.value)}
      onKeyDown={(event) => {
        // The blur's commit (the Enter / the Escape — the shape text's
        // contract); the keys stand no canvas / editor gesture (the
        // container's hotkeys keep the editing surface off).
        if (event.key === "Enter" || event.key === "Escape") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        event.stopPropagation();
      }}
    />
  );
}

export { ConnectorLabelEdit };
