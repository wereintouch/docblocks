import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef } from "react";

import type { BlockId } from "docblocks-core";
import type { Block } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import { SHAPE_FONT_STACKS, SHAPE_TEXT_DEFAULT_SIZE, SHAPE_TEXT_WEIGHTS } from "../canvas/text-fonts";
import { DEFAULT_CANVAS_ITEM_SIZE } from "./canvas-geometry";
import { useCanvasTextEdit } from "./canvas-text-edit-context";

/** The shape's narrowed block view (the attrs stand). */
type ShapeBlockView = Extract<Block, { type: "shape" }>;

/** The shape's text padding (the figure's edge inset): the text wraps at
 * the figure's edges, so the box stands clear of them — the larger inset
 * for the non-rect figures (the text must stay inside the ellipse / the
 * diamond's inscribed box). */
const SHAPE_TEXT_PADDING: Record<string, { x: number; y: number }> = {
  rect: { x: 8, y: 8 },
  rounded: { x: 12, y: 8 },
  ellipse: { x: 0.2, y: 0.2 },
  diamond: { x: 0.25, y: 0.25 },
};

/** The style attrs' inline mapping (the data, not theme — like the
 * canvas-text's font attrs): the weight x the slant of the `textStyle`,
 * the default's stand (the editor's sans, 16px, the center alignment). */
function shapeTextStyle(block: ShapeBlockView, w: number, h: number): CSSProperties {
  const attrs = block.attrs;
  const variant = attrs?.variant ?? "rect";
  const padding = SHAPE_TEXT_PADDING[variant] ?? { x: 8, y: 8 };
  const pxX = typeof padding.x === "number" && padding.x < 1 ? w * padding.x : padding.x;
  const pxY = typeof padding.y === "number" && padding.y < 1 ? h * padding.y : padding.y;
  const style = attrs?.textStyle;
  const weight =
    style === "light" || style === "light-italic"
      ? SHAPE_TEXT_WEIGHTS.light
      : style === "semibold" || style === "semibold-italic"
        ? SHAPE_TEXT_WEIGHTS.semibold
        : SHAPE_TEXT_WEIGHTS.regular;
  const italic = /italic$/.test(style ?? "");
  return {
    fontFamily: attrs?.fontFamily !== undefined ? (SHAPE_FONT_STACKS[attrs.fontFamily] ?? attrs.fontFamily) : undefined,
    fontSize: attrs?.fontSize ?? SHAPE_TEXT_DEFAULT_SIZE,
    color: attrs?.textColor,
    fontWeight: weight,
    fontStyle: italic ? "italic" : undefined,
    textAlign: attrs?.textAlign ?? "center",
    padding: `${pxY}px ${pxX}px`,
    lineHeight: 1.2,
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
  };
}

/**
 * The shape's text overlay (the double-click's inline text): an
 * absolutely-positioned box inside the shape's
 * positioned wrapper (the figure's SVG stands under it), centered
 * vertically, wrapping at the figure's edges. The text is the `text`
 * attr (a plain string, the soft breaks as \n — the shape is not a text
 * block, so no runs / marks; the style is uniform per shape). The edit:
 * the double-click enters the inline edit (the contenteditable inner —
 * the canvas's editing-surface guard keeps it out of the canvas
 * sessions), the blur / the Escape commits (one `updateBlock` in one
 * transact — one undo step, one wire update); the empty commit clears
 * the text to the empty string (the textless stand).
 */
function ShapeText({ id, block }: { id: BlockId; block: ShapeBlockView }) {
  const { doc } = useEditorContext();
  const textEdit = useCanvasTextEdit();
  const editing = textEdit !== null && textEdit.editingId === id;
  const innerRef = useRef<HTMLDivElement | null>(null);
  const committedRef = useRef(false);
  const text = block.attrs?.text ?? "";
  const w = block.geometry?.w ?? DEFAULT_CANVAS_ITEM_SIZE;
  const h = block.geometry?.h ?? DEFAULT_CANVAS_ITEM_SIZE;

  // The edit's seed (the text stands the attr, not the DOM): the inner
  // stands the attr's text on entry (the browser's edit is the draft).
  useEffect(() => {
    if (!editing || innerRef.current === null) return;
    committedRef.current = false;
    innerRef.current.textContent = text;
    innerRef.current.focus();
    // The caret stands at the end (the append stand).
    const selection = window.getSelection();
    if (selection !== null) {
      const range = document.createRange();
      range.selectNodeContents(innerRef.current);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    // The seed runs on entry only (the attr change re-renders the read
    // form while editing — the draft stands).
  }, [editing]);

  const commit = (value: string) => {
    if (committedRef.current) return;
    committedRef.current = true;
    textEdit?.setEditingId(null);
    if (value === text) return;
    doc.transact(() => {
      doc.updateBlock(id, { text: value });
    });
  };

  const content: ReactNode = editing ? (
    <div
      ref={innerRef}
      contentEditable
      data-slot="docblocks/shape-text-edit"
      suppressContentEditableWarning
      className="w-full outline-none"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          innerRef.current?.blur();
        }
        // The text box keeps its keys (no canvas / editor hotkeys while
        // the shape's text is in the edit).
        event.stopPropagation();
      }}
      // innerText maps the <br> soft breaks to \n (the read stand);
      // textContent is the jsdom fallback (innerText stands layout-only).
      onBlur={() => commit(innerRef.current?.innerText ?? innerRef.current?.textContent ?? "")}
    />
  ) : (
    <div className="w-full" data-slot="docblocks/shape-text">
      {text}
    </div>
  );
  // The overlay is always pointer-receiving (the dblclick's edit entry,
  // the text's hover): the canvas's press resolves the item through the
  // wrapper's data-slot (the overlay's press stands the same item —
  // closest, like the figure's). The edit keeps the pointer (the
  // contenteditable's editing-surface guard stands the canvas's
  // sessions off).
  return (
    <div
      // The full-size dblclick's TARGET (the figure's box; the inner
      // content div stands the text only — an empty text is a zero-height
      // box, the press would stand no target). The dblclick's entry
      // stands the canvas container's handler (the press's pointer
      // capture retargets the event to the container — the hit test
      // stands the shape). The contenteditable's editing-surface guard
      // keeps the entry's presses out of the canvas sessions.
      data-slot="docblocks/shape-text-target"
      className="absolute inset-0 flex items-center"
      style={shapeTextStyle(block, w, h)}
    >
      {content}
    </div>
  );
}

export { ShapeText };
