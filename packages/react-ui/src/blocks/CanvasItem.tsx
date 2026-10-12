import { useStore } from "zustand";

import type { CSSProperties, ReactNode } from "react";

import type { BlockId } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import { useBlock } from "../hooks";
import { BlockView } from "./BlockView";
import { FrameBlock } from "./FrameBlock";
import { ShapeSvg } from "./ShapeSvg";
import { TextBlock } from "./TextBlock";
import { useBlockContext } from "./block-context";
import { canvasItemStyle, endpointOf, isCanvasSubType } from "./canvas-geometry";

/**
 * A canvas element: the positioned wrapper (the geometry -> the style)
 * around the element's renderer. The canvas-only types render their
 * built-in canvas renderers HERE (not through BlockView — they render
 * ONLY inside a surface; a stray one at the page root falls to the
 * placeholder). A consumer renderer for a canvas-only type wins over the
 * built-in. No gutter / selection handle (the interaction stage adds
 * those). The canvas-text's font attrs are data (not theme): inline
 * styles on the wrapper.
 */
function CanvasItem({ id }: { id: BlockId }) {
  const { store, renderers } = useEditorContext();
  const { siblings } = useBlockContext();
  const block = useBlock(id);
  const blocks = useStore(store, (state) => state.blocks);
  if (block === undefined) return null;
  let content: ReactNode;
  if (isCanvasSubType(block.type)) {
    const custom = renderers[block.type];
    content =
      custom !== undefined ? (
        custom({ id, block })
      ) : block.type === "shape" ? (
        <ShapeSvg id={id} block={block} />
      ) : block.type === "canvas-text" ? (
        <TextBlock id={id} block={block} tag="div" />
      ) : block.type === "frame" ? (
        <FrameBlock id={id} />
      ) : null; // connector: the line lives in the overlay layer
  } else {
    content = <BlockView id={id} />;
  }

  const style = canvasItemStyle(block);
  if (block.type === "canvas-text") {
    const { fontSize, fontFamily, textAlign } = block.attrs ?? {};
    if (fontSize !== undefined) style.fontSize = fontSize;
    if (fontFamily !== undefined) style.fontFamily = fontFamily;
    if (textAlign !== undefined) {
      // The attr is an open CSS value (the schema keeps it a string); the
      // style type is the closed TextAlign union.
      style.textAlign = textAlign as CSSProperties["textAlign"];
    }
  }

  // The connector's lenient posture: an endpoint that does not resolve
  // within the surface (a docId ref, an absent block, or attrs missing in
  // raw data) is marked here — the overlay skips the line.
  const missing =
    block.type === "connector" &&
    (block.attrs === undefined ||
      endpointOf(block.attrs.start, siblings, blocks) === null ||
      endpointOf(block.attrs.end, siblings, blocks) === null);

  return (
    <div data-slot="docblocks/canvas-item" data-block-id={id} data-missing={missing || undefined} style={style}>
      {content}
    </div>
  );
}

export { CanvasItem };
