import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";

import type { Block, TextAlign, TextRun } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import { useBlock, useSelection } from "../hooks";
import { type FormatMark, markToggleAction } from "./keyboard";

/**
 * The floating format toolbar — the selection's formatting affordance.
 *
 * It is visible while the view's selection is a text range inside a single
 * block of a toolbar-eligible type (paragraph, heading, list-item, callout,
 * latex; code and canvas-text have their own formatting model, and a
 * cross-block range has no single target block), and floats above the
 * selection (below it when there is no room above). It disappears as soon
 * as the selection collapses, leaves the block, or becomes a blocks
 * selection — the visibility is derived from the selection state, so no
 * key or mouse capture is needed.
 *
 * Controls: the five toggle marks (bold, monospace = the exclusive code
 * mark, italic, underline, strikethrough) applied over the range; the three
 * text alignments, a block attr applied with updateBlock (set-only:
 * updateBlock never removes attrs, so "left" is how the default is
 * restored); and the highlight control — a palette popover with a target
 * switch (the text `color` mark vs the background `highlight` mark) and a
 * color palette (the default six, overridable through the editor's
 * `formatPalette` prop) plus a clear entry. A mark button is active when
 * every run of the range carries the mark; a swatch is active when the
 * whole range is uniformly marked with that value (a highlight without a
 * value counts as the empty value). Every action is a doc command inside
 * one transaction (one undo step, one wire update).
 */

/** The default format palette (a consumer can pass its own through the editor prop). */
const FORMAT_PALETTE: readonly string[] = ["#71717a", "#e11d48", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6"];

/** The block types the toolbar formats (a single-block text range inside one). */
const TOOLBAR_BLOCK_TYPES: ReadonlySet<string> = new Set(["paragraph", "heading", "list-item", "callout", "latex"]);

/** The toggle mark buttons, in display order. */
const TOOLBAR_MARKS: { mark: FormatMark; label: string; title: string; style: CSSProperties }[] = [
  { mark: "bold", label: "B", title: "Bold", style: { fontWeight: 700 } },
  { mark: "code", label: "</>", title: "Monospace", style: { fontFamily: "monospace", fontSize: "0.9em" } },
  { mark: "italic", label: "I", title: "Italic", style: { fontStyle: "italic" } },
  { mark: "underline", label: "U", title: "Underline", style: { textDecoration: "underline" } },
  { mark: "strike", label: "S", title: "Strikethrough", style: { textDecoration: "line-through" } },
];

/** The alignment buttons, in display order. */
const TOOLBAR_ALIGNS: { align: TextAlign; label: string; title: string }[] = [
  { align: "left", label: "L", title: "Align left" },
  { align: "center", label: "C", title: "Align center" },
  { align: "right", label: "R", title: "Align right" },
];

/** The palette target: which mark the picked color is applied to. */
type PaletteTarget = "color" | "highlight";

/** Clamp a number into [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** The current alignment of a snapshot block (absent for types without the attr). */
function alignOf(block: Block): TextAlign | undefined {
  switch (block.type) {
    case "paragraph":
      return block.attrs?.align;
    case "callout":
      return block.attrs?.align;
    case "heading":
    case "latex":
    case "list-item":
      return block.attrs.align;
    default:
      return undefined;
  }
}

/**
 * The uniform value of the `color` / `highlight` mark over [from, to): the
 * value when every overlapping run carries the mark with it (a highlight
 * without a value reads as the empty string), null when no overlapping run
 * carries the mark, "mixed" otherwise.
 */
function uniformMarkValue(
  block: Block,
  from: number,
  to: number,
  mark: "color" | "highlight"
): string | null | "mixed" {
  if (!("content" in block)) return "mixed";
  const runs: TextRun[] = block.content ?? [];
  let pos = 0;
  let value: string | null | undefined;
  let seen = false;
  for (const run of runs) {
    const start = pos;
    pos += run.text.length;
    if (pos <= from || start >= to) continue;
    const read = run.marks[mark];
    const here = read === undefined ? null : (read.value ?? "");
    if (!seen) {
      value = here;
      seen = true;
    } else if (value !== here) {
      return "mixed";
    }
  }
  return seen ? (value ?? "") : null;
}

interface FormatToolbarProps {
  rootRef: RefObject<HTMLElement | null>;
  palette: readonly string[];
}

function FormatToolbar({ rootRef, palette }: FormatToolbarProps) {
  const { doc } = useEditorContext();
  const selection = useSelection();
  const barRef = useRef<HTMLDivElement | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [target, setTarget] = useState<PaletteTarget>("highlight");

  // A range inside a single block (the toolbar's only target shape).
  const range =
    selection.kind === "text" &&
    selection.to !== null &&
    selection.from.blockId === selection.to.blockId &&
    selection.from.offset !== selection.to.offset
      ? { blockId: selection.from.blockId, from: selection.from.offset, to: selection.to.offset }
      : null;

  const block = useBlock(range !== null ? range.blockId : "");
  const eligible = range !== null && block !== undefined && TOOLBAR_BLOCK_TYPES.has(block.type);

  // A moved selection is a fresh toolbar context: the palette closes. The
  // key (not the selection object) is the trigger — a mark applied through
  // the palette rebases the selection in place, which must not close it.
  const selectionKey =
    selection.kind === "text"
      ? `${selection.from.blockId}:${selection.from.offset}:${selection.to?.offset ?? "caret"}`
      : selection.kind;
  useEffect(() => {
    setPaletteOpen(false);
  }, [selectionKey]);

  // Anchor the bar above the selection rect (below it when there is no
  // room) and clamp it horizontally inside the editor root.
  useLayoutEffect(() => {
    const el = barRef.current;
    const root = rootRef.current;
    if (el === null || root === null) return;
    const domSelection = window.getSelection();
    if (domSelection === null || domSelection.rangeCount === 0) return;
    if (!root.contains(domSelection.anchorNode)) return;
    const range = domSelection.getRangeAt(0);
    // Environments without layout (jsdom) have no range geometry: the bar
    // stays at its default position there.
    if (typeof range.getBoundingClientRect !== "function") return;
    const rect = range.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const left = clamp(
      rect.left + rect.width / 2 - width / 2 - rootRect.left,
      8,
      Math.max(8, rootRect.width - width - 8)
    );
    const above = rect.top - rootRect.top - height - 8;
    const top = above < 4 ? rect.bottom - rootRect.top + 8 : above;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  });

  if (range === null || block === undefined || !eligible) return null;
  const { blockId, from, to } = range;

  /** Toggle a mark over the range (one transaction; the decision reads the snapshot). */
  const onToggleMark = (mark: FormatMark): void => {
    const action = markToggleAction(doc, blockId, from, to, mark);
    doc.transact(() => {
      if (action === "unset") doc.unsetMark(blockId, from, to, mark);
      else doc.setMark(blockId, from, to, { type: mark });
    });
  };

  /** Apply an alignment (set-only; the current one is a visible no-op). */
  const onAlign = (align: TextAlign): void => {
    if (alignOf(block) === align) return;
    doc.transact(() => {
      doc.updateBlock(blockId, { align });
    });
  };

  /** Apply the palette target's mark with the value (or clear it). */
  const onPaletteValue = (value: string | null): void => {
    const current = uniformMarkValue(block, from, to, target);
    if (current === value) return;
    doc.transact(() => {
      if (value === null) doc.unsetMark(blockId, from, to, target);
      else if (target === "color") doc.setMark(blockId, from, to, { type: "color", value });
      else doc.setMark(blockId, from, to, { type: "highlight", value });
    });
  };

  return (
    <div
      data-slot="docblocks/format-toolbar"
      ref={barRef}
      role="toolbar"
      aria-label="Text formatting"
      // Keep the text selection: a default mousedown would move the caret
      // into the bar and dismiss the toolbar (the selection maps to none).
      onMouseDown={(event) => event.preventDefault()}
    >
      {TOOLBAR_MARKS.map(({ mark, label, title, style }) => (
        <button
          key={mark}
          type="button"
          data-mark={mark}
          title={title}
          aria-label={title}
          aria-pressed={markToggleAction(doc, blockId, from, to, mark) === "unset"}
          style={style}
          onClick={() => onToggleMark(mark)}
        >
          {label}
        </button>
      ))}
      <span data-slot="docblocks/format-separator" aria-hidden="true" />
      {TOOLBAR_ALIGNS.map(({ align, label, title }) => (
        <button
          key={align}
          type="button"
          data-align-btn={align}
          title={title}
          aria-label={title}
          aria-pressed={alignOf(block) === align}
          onClick={() => onAlign(align)}
        >
          {label}
        </button>
      ))}
      <span data-slot="docblocks/format-separator" aria-hidden="true" />
      <div style={{ position: "relative" }}>
        <button
          type="button"
          data-target="highlight"
          title="Text and background color"
          aria-label="Text and background color"
          aria-expanded={paletteOpen}
          onClick={() => setPaletteOpen((open) => !open)}
        >
          A
        </button>
        {paletteOpen && (
          <div
            data-slot="docblocks/format-palette"
            role="group"
            // Same guard: the popover is part of the bar layer.
            onMouseDown={(event) => event.preventDefault()}
          >
            <div role="group" aria-label="Color target" style={{ gridColumn: "1 / -1", display: "flex", gap: 2 }}>
              {(["highlight", "color"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  data-target-btn={t}
                  aria-pressed={target === t}
                  aria-label={t === "highlight" ? "Highlight the background" : "Color the text"}
                  title={t === "highlight" ? "Highlight the background" : "Color the text"}
                  style={{ fontSize: "0.85em", padding: "0 4px", flex: 1 }}
                  onClick={() => setTarget(t)}
                >
                  {t === "highlight" ? "bg" : "text"}
                </button>
              ))}
            </div>
            {palette.map((color) => (
              <button
                key={color}
                type="button"
                data-slot="docblocks/format-swatch"
                data-color={color}
                title={color}
                aria-label={`${target} color ${color}`}
                aria-pressed={uniformMarkValue(block, from, to, target) === color}
                style={{ background: color }}
                onClick={() => onPaletteValue(color)}
              />
            ))}
            <button
              type="button"
              data-slot="docblocks/format-swatch"
              data-color="none"
              title="No color"
              aria-label="No color"
              aria-pressed={uniformMarkValue(block, from, to, target) === null}
              style={{ background: "transparent", position: "relative" }}
              onClick={() => onPaletteValue(null)}
            >
              ✕
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** The editor-level format toolbar layer (null while no eligible range is selected). */
function useFormatToolbar(
  rootRef: RefObject<HTMLElement | null>,
  palette: readonly string[]
): { toolbarNode: ReactNode } {
  return { toolbarNode: <FormatToolbar rootRef={rootRef} palette={palette} /> };
}

export { FORMAT_PALETTE, useFormatToolbar };
