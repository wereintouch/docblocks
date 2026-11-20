/** The floating format toolbar — the selection's formatting affordance.
 *
 * It is visible while the view's selection is a text range over a
 * toolbar-eligible target: a single block of an eligible type (paragraph,
 * quote, heading, list-item, callout, table-cell; code and
 * canvas-text have their own formatting model) or a cross-block range
 * whose chain text blocks are all eligible. It floats above the selection
 * (below it when there is no room above) and disappears as soon as the
 * selection collapses, leaves the target, or becomes a blocks selection —
 * the visibility is derived from the selection state, so no key or mouse
 * capture is needed.
 *
 * Controls (shared/ui primitives): the five toggle marks (bold, monospace
 * = the exclusive code mark, italic, underline, strikethrough) and the
 * three text alignments as ghost icon buttons, the list-type menu (the
 * single-block targets only — the `FormatListMenu`), and the color palette
 * (the text's `color` vs the background's `highlight` — the
 * `FormatPalette`). The actions stand in the actions' module (one doc
 * command's set inside one transaction — one undo step, one wire
 * update). The portaled popovers — like the bar — suppress the default
 * mousedown so the editor's text selection stays alive while a swatch or
 * option is picked.
 */
import { useTranslation } from "react-i18next";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { Block } from "docblocks-core";

import { useEditorContext } from "../../editor-provider";
import { useBlock, useSelection } from "../../hooks";
import { Button } from "../../shared/ui/Button";
import { Separator } from "../../shared/ui/Separator";
import { cn } from "../../shared/ui/cn";
import { clamp, preventDefault } from "../../shared/utils";
import { TOOLBAR_BLOCK_TYPES, crossRangeEligible, crossRangeOf } from "../format-range";
import { FormatListMenu } from "./FormatListMenu";
import { FormatPalette } from "./FormatPalette";
import { ACTIVE_ITEM_CLASS, TOOLBAR_ALIGNS, TOOLBAR_MARKS } from "./constants";
import { createFormatToolbarActions } from "./format-toolbar-actions";
import type { FormatToolbarProps, PaletteTarget, ToolbarRange } from "./models";

function FormatToolbar({ rootRef, palette }: FormatToolbarProps) {
  const { t } = useTranslation("editor");
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

  const actions = createFormatToolbarActions({
    doc,
    range,
    single,
    target,
    rootRef,
    onPaletteClose: () => setPaletteOpen(false),
    onListMenuClose: () => setListMenuOpen(false),
  });

  // The list-type radio state (single-block eligible targets only — the
  // menu renders for paragraph, heading, and list-item blocks; the
  // cross-block target never renders it and has no `single` block).
  const listValue =
    block !== undefined && block.type === "list-item"
      ? block.attrs.list
      : block !== undefined && block.type === "paragraph"
        ? "paragraph"
        : block !== undefined && block.type === "quote"
          ? "quote"
          : "";

  // The callout's controls (the type preset / the background / the icon)
  // stand the block's own management menu (the clickable marker-zone icon —
  // the CalloutBlockMenu): the toolbar for a callout's text range is the
  // shared text marks + the alignment only.

  return (
    <div
      data-slot="docblocks/format-toolbar"
      ref={barRef}
      role="toolbar"
      aria-label={t("formatToolbar.aria")}
      className="
        absolute z-50 flex items-center gap-0.5 rounded-(--docblocks-radius) border
        border-(--docblocks-formatbar-border-color) bg-(--docblocks-formatbar-background) p-1 text-[0.8125em]
        text-(--docblocks-text-color) shadow-(--docblocks-formatbar-shadow)
      "
      // Keep the text selection: a default mousedown would move the caret
      // into the bar and dismiss the toolbar (the selection maps to none).
      onMouseDown={preventDefault}
    >
      {TOOLBAR_MARKS.map(({ mark, title, icon: Icon }) => (
        <Button
          key={mark}
          variant="ghost"
          size="icon"
          data-mark={mark}
          title={t(title)}
          aria-label={t(title)}
          aria-pressed={actions.markActive(mark)}
          className={cn(actions.markActive(mark) && ACTIVE_ITEM_CLASS)}
          onClick={() => actions.onToggleMark(mark)}
        >
          <Icon className="size-4" />
        </Button>
      ))}
      <Separator orientation="vertical" className="h-5" />
      {TOOLBAR_ALIGNS.map(({ align, title, icon: Icon }) => (
        <Button
          key={align}
          variant="ghost"
          size="icon"
          data-align-btn={align}
          title={t(title)}
          aria-label={t(title)}
          aria-pressed={actions.alignActive(align)}
          className={cn(actions.alignActive(align) && ACTIVE_ITEM_CLASS)}
          onClick={() => actions.onAlign(align)}
        >
          <Icon className="size-4" />
        </Button>
      ))}
      {!cross &&
        (single.type === "paragraph" ||
          single.type === "quote" ||
          single.type === "heading" ||
          single.type === "list-item") && (
          <>
            <Separator orientation="vertical" className="h-5" />
            <FormatListMenu
              open={listMenuOpen}
              onOpenChange={setListMenuOpen}
              value={listValue}
              onOption={actions.onListOption}
            />
          </>
        )}
      <Separator orientation="vertical" className="h-5" />
      <FormatPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        target={target}
        onTargetChange={setTarget}
        onValue={actions.onPaletteValue}
        palette={palette}
        paletteActive={actions.paletteActive}
        currentMarkValue={actions.currentMarkValue}
        chipValue={actions.chipValue}
      />
    </div>
  );
}

export { FormatToolbar };
