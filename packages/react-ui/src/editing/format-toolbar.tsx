import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";

import type { Block, BlockId, TextAlign } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import { useBlock, useSelection } from "../hooks";
import { restoreSelectionIn } from "./block-commands";
import {
  TOOLBAR_BLOCK_TYPES,
  alignOfBlock,
  applyAlignRange,
  applyMarkRange,
  applyValueMarkRange,
  clearMarkRange,
  crossRangeEligible,
  crossRangeOf,
  rangeMarkAction,
  uniformAlignOfRange,
  uniformMarkValue,
  uniformMarkValueRange,
} from "./format-range";
import type { CrossRange } from "./format-range";
import { type FormatMark, markToggleAction } from "./keyboard";

/**
 * The floating format toolbar — the selection's formatting affordance.
 *
 * It is visible while the view's selection is a text range over a
 * toolbar-eligible target: a single block of an eligible type (paragraph,
 * heading, list-item, callout, latex; code and canvas-text have their own
 * formatting model) or a cross-block range whose chain text blocks are all
 * eligible. It floats above the selection (below it when there is no room
 * above) and disappears as soon as the selection collapses, leaves the
 * target, or becomes a blocks selection — the visibility is derived from
 * the selection state, so no key or mouse capture is needed.
 *
 * Controls: the five toggle marks (bold, monospace = the exclusive code
 * mark, italic, underline, strikethrough); the three text alignments, a
 * block attr applied with updateBlock (set-only: updateBlock never removes
 * attrs, so "left" is how the default is restored); the highlight control —
 * a palette popover with a target switch (the text `color` mark vs the
 * background `highlight` mark) and a color palette (the default six,
 * overridable through the editor's `formatPalette` prop) plus a clear
 * entry; and the list-type menu (single-block targets only — for paragraph,
 * heading, and list-item blocks) — a popover that turns the block into a
 * bullet/numbered/to-do list (a list-item swap is a `list` attr update; any
 * other target is a changeBlockType) or into a paragraph (the "Text" option
 * is disabled for a list item with children: the core rejects a container
 * becoming a leaf while it has children). A cross-block range applies the
 * mark actions over the range's per-block segments (the align per chain
 * block) and hides the list-type menu. A mark button is active when every
 * run of the range carries the mark; a swatch is active when the whole
 * range is uniformly marked with that value (a highlight without a value
 * counts as the empty value). Every action is doc command(s) inside one
 * transaction (one undo step, one wire update).
 */

/** The default format palette (a consumer can pass its own through the editor prop). */
const FORMAT_PALETTE: readonly string[] = ["#71717a", "#e11d48", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6"];

/** The list-type menu options, in display order ("paragraph" = turn into text). */
const LIST_MENU_OPTIONS: { option: "bullet" | "number" | "task" | "paragraph"; label: string; glyph: string }[] = [
  { option: "bullet", label: "Bullet list", glyph: "\u2022" },
  { option: "number", label: "Numbered list", glyph: "1." },
  { option: "task", label: "To-do list", glyph: "\u2610" },
  { option: "paragraph", label: "Text", glyph: "\u00B6" },
];

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

/** The toolbar's target range: a same-block range or a cross-block range over the engine's chain. */
type ToolbarRange =
  { kind: "single"; blockId: BlockId; from: number; to: number } | { kind: "cross"; cross: CrossRange };

/** Clamp a number into [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
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
  const [listMenuOpen, setListMenuOpen] = useState(false);
  const [target, setTarget] = useState<PaletteTarget>("highlight");

  // The toolbar's target: a range inside a single block, or a cross-block
  // range whose chain text blocks are all toolbar-eligible.
  const range = useMemo<ToolbarRange | null>(() => {
    if (selection.kind !== "text" || selection.to === null) return null;
    if (selection.from.blockId === selection.to.blockId) {
      if (selection.from.offset === selection.to.offset) return null;
      return { kind: "single", blockId: selection.from.blockId, from: selection.from.offset, to: selection.to.offset };
    }
    const cross = crossRangeOf(selection);
    return cross !== null && crossRangeEligible(doc, cross) ? { kind: "cross", cross } : null;
  }, [doc, selection]);

  const block = useBlock(range !== null && range.kind === "single" ? range.blockId : "");

  // A moved selection is a fresh toolbar context: the palette closes. The
  // key (not the selection object) is the trigger — a mark applied through
  // the palette rebases the selection in place, which must not close it.
  const selectionKey =
    selection.kind === "text"
      ? `${selection.from.blockId}:${selection.from.offset}:${selection.to?.blockId ?? ""}:${selection.to?.offset ?? "caret"}`
      : selection.kind;
  useEffect(() => {
    setPaletteOpen(false);
    setListMenuOpen(false);
  }, [selectionKey]);

  // Anchor the bar above the selection rect (below it when there is no
  // room) and clamp it horizontally inside the editor root. The rect of a
  // cross-block DOM selection works the same way as a single-block one.
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

  if (range === null) return null;
  if (range.kind === "single" && (block === undefined || !TOOLBAR_BLOCK_TYPES.has(block.type))) return null;
  // The single target is defined here (the guard above); a cross target
  // never reads it (its branches short-circuit first).
  const single = block as Block;
  const cross = range.kind === "cross";

  /** Toggle a mark over the target (one undo step, one wire update). */
  const onToggleMark = (mark: FormatMark): void => {
    if (range.kind === "cross") {
      if (rangeMarkAction(doc, range.cross, mark) === "unset") clearMarkRange(doc, range.cross, mark);
      else applyMarkRange(doc, range.cross, mark);
      return;
    }
    const action = markToggleAction(doc, range.blockId, range.from, range.to, mark);
    doc.transact(() => {
      if (action === "unset") doc.unsetMark(range.blockId, range.from, range.to, mark);
      else doc.setMark(range.blockId, range.from, range.to, { type: mark });
    });
  };

  /** Apply an alignment (set-only; the current one is a visible no-op). */
  const onAlign = (align: TextAlign): void => {
    if (range.kind === "cross") {
      if (uniformAlignOfRange(doc, range.cross) === align) return;
      applyAlignRange(doc, range.cross, align);
      return;
    }
    if (alignOfBlock(single) === align) return;
    doc.transact(() => {
      doc.updateBlock(range.blockId, { align });
    });
  };

  /** Apply the palette target's mark with the value (or clear it). */
  const onPaletteValue = (value: string | null): void => {
    if (range.kind === "cross") {
      const current = uniformMarkValueRange(doc, range.cross, target);
      if (current === value) return;
      if (value === null) clearMarkRange(doc, range.cross, target);
      else applyValueMarkRange(doc, range.cross, target, value);
      return;
    }
    const current = uniformMarkValue(single, range.from, range.to, target);
    if (current === value) return;
    doc.transact(() => {
      if (value === null) doc.unsetMark(range.blockId, range.from, range.to, target);
      else if (target === "color") doc.setMark(range.blockId, range.from, range.to, { type: "color", value });
      else doc.setMark(range.blockId, range.from, range.to, { type: "highlight", value });
    });
  };

  /**
   * The list-type menu action (single-block targets only): a swap inside a
   * list is a `list` attr update; any other target is a type change (the
   * target's required attrs come from the option). "Text" is unreachable
   * for a list item with children (the option is disabled; the core would
   * reject it).
   */
  const onListOption = (option: (typeof LIST_MENU_OPTIONS)[number]["option"]): void => {
    setListMenuOpen(false);
    if (range.kind !== "single") return;
    // A list-type swap or a type change remounts the block's subtree (the
    // wrapper tag swaps), so the DOM selection dies with it: the gesture's
    // range is re-seated on the rebuilt block (the content stands, so the
    // offsets remain valid).
    const seat: { from: number; to: number } = { from: range.from, to: range.to };
    // The gesture's own inner element: the motion view's exit clone keeps
    // this node connected while the remount adds the survivor, so the
    // re-seat must not mistake the clone for the target.
    const exclude =
      rootRef.current?.querySelector<HTMLElement>(
        `[data-block-id="${range.blockId}"][data-slot="docblocks/block-content"]`
      ) ?? null;
    if (option === "paragraph") {
      if (single.type !== "paragraph") doc.transact(() => doc.changeBlockType(range.blockId, "paragraph"));
      restoreSelectionIn(doc, range.blockId, seat.from, seat.to, rootRef.current ?? document, exclude);
      return;
    }
    const currentList = single.type === "list-item" ? single.attrs.list : null;
    if (currentList === option) return;
    doc.transact(() => {
      if (single.type === "list-item") doc.updateBlock(range.blockId, { list: option });
      else doc.changeBlockType(range.blockId, "list-item", { list: option });
    });
    restoreSelectionIn(doc, range.blockId, seat.from, seat.to, rootRef.current ?? document, exclude);
  };

  const markActive = (mark: FormatMark): boolean =>
    range.kind === "cross"
      ? rangeMarkAction(doc, range.cross, mark) === "unset"
      : markToggleAction(doc, range.blockId, range.from, range.to, mark) === "unset";

  const alignActive = (align: TextAlign): boolean =>
    range.kind === "cross" ? uniformAlignOfRange(doc, range.cross) === align : alignOfBlock(single) === align;

  const paletteActive = (value: string | null): boolean =>
    range.kind === "cross"
      ? uniformMarkValueRange(doc, range.cross, target) === value
      : uniformMarkValue(single, range.from, range.to, target) === value;

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
          aria-pressed={markActive(mark)}
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
          aria-pressed={alignActive(align)}
          onClick={() => onAlign(align)}
        >
          {label}
        </button>
      ))}
      {!cross && (single.type === "paragraph" || single.type === "heading" || single.type === "list-item") && (
        <>
          <span data-slot="docblocks/format-separator" aria-hidden="true" />
          <div style={{ position: "relative" }}>
            <button
              type="button"
              title="List type"
              aria-label="List type"
              aria-expanded={listMenuOpen}
              onClick={() => setListMenuOpen((open) => !open)}
            >
              {"\u2261"}
            </button>
            {listMenuOpen && (
              <div
                data-slot="docblocks/format-list-menu"
                role="group"
                aria-label="List type"
                // Same guard: the popover is part of the bar layer.
                onMouseDown={(event) => event.preventDefault()}
              >
                {LIST_MENU_OPTIONS.map(({ option, label, glyph }) => {
                  const active =
                    single.type === "list-item"
                      ? single.attrs.list === option
                      : single.type === "paragraph" && option === "paragraph";
                  const disabled =
                    option === "paragraph" && single.type === "list-item" && (single.children ?? []).length > 0;
                  return (
                    <button
                      key={option}
                      type="button"
                      data-list-option={option}
                      aria-pressed={active}
                      disabled={disabled}
                      title={disabled ? "List items with children cannot become text" : label}
                      onClick={() => onListOption(option)}
                    >
                      <span aria-hidden="true" style={{ width: 14, textAlign: "center" }}>
                        {glyph}
                      </span>
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
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
                aria-pressed={paletteActive(color)}
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
              aria-pressed={paletteActive(null)}
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
): {
  toolbarNode: ReactNode;
} {
  return { toolbarNode: <FormatToolbar rootRef={rootRef} palette={palette} /> };
}

export { FORMAT_PALETTE, useFormatToolbar };
