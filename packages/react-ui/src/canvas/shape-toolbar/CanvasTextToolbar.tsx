/**
 * The canvas-text's floating toolbar (the single `canvas-text` selection):
 * the shared text controls (the font family / color / style / size / the
 * alignment — the ShapeTextControls' canvas-text's slot namespace) + the
 * z-order menu (the canvas-text carries the explicit zIndex — the
 * position / count over the surface's canvas elements). Each apply is one
 * `updateBlock` in one transact (one undo step, one wire update). The
 * toolbar is canvas chrome (its own pointers; a press on it starts no
 * canvas session).
 */
import type { CSSProperties } from "react";
import { useState } from "react";

import type { BlockId } from "docblocks-core";

import { useEditorContext } from "../../editor-provider";
import { Separator } from "../../shared/ui/Separator";
import { ZOrderMenu } from "../ZOrderMenu";
import { ShapeTextControls } from "./ShapeTextControls";
import { onToolbarBodyMouseDown } from "./utils";

function CanvasTextToolbar({
  id,
  fontFamily,
  textColor,
  textStyle,
  fontSize,
  textAlign,
  zStand,
  style,
}: {
  id: BlockId;
  fontFamily: string | undefined;
  textColor: string | undefined;
  textStyle: string | undefined;
  fontSize: number | undefined;
  textAlign: string | undefined;
  /** The z-order stand (the position / count over the surface's canvas
   *  elements); absent when the target's surface is unknown. */
  zStand: { position: number; count: number } | null;
  style: CSSProperties;
}) {
  const { doc } = useEditorContext();
  // The text color section's open state (the non-modal popover's parity —
  // the single section stands its own stand).
  const [textColorOpen, setTextColorOpen] = useState(false);
  const sizeListId = `docblocks-canvas-text-size-${id}`;

  const applyAttr = (patch: Record<string, unknown>) => {
    // The target's concurrent deletion (the peer removed the block): the
    // block is gone — the gesture stands a no-op (the command over the
    // detached block would throw the typed error into the event handler).
    if (doc.getBlock(id) === null) return;
    doc.transact(() => {
      doc.updateBlock(id, patch);
    });
  };

  return (
    <div
      data-slot="docblocks/canvas-chrome"
      className="absolute z-50"
      style={{ ...style, transform: "translate(-50%, -100%)" }}
      onMouseDown={onToolbarBodyMouseDown}
    >
      <div
        data-slot="docblocks/canvas-text-toolbar"
        role="toolbar"
        aria-label="Text options"
        className="
          flex items-center gap-0.5 rounded-(--docblocks-radius) border border-(--docblocks-formatbar-border-color)
          bg-(--docblocks-formatbar-background) p-1 text-(--docblocks-text-color) shadow-(--docblocks-formatbar-shadow)
        "
      >
        <ShapeTextControls
          slotPrefix="docblocks/canvas-text-toolbar"
          sizeListId={sizeListId}
          fontFamily={fontFamily}
          textColor={textColor}
          textStyle={textStyle}
          fontSize={fontSize}
          textAlign={textAlign}
          textColorOpen={textColorOpen}
          onTextColorOpenChange={setTextColorOpen}
          onApply={applyAttr}
        />
        <Separator orientation="vertical" className="h-5" />
        {zStand !== null && (
          <ZOrderMenu targetId={id} position={zStand.position} count={zStand.count} label="Arrange text" />
        )}
      </div>
    </div>
  );
}

export { CanvasTextToolbar };
