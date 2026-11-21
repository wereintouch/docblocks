import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import type { BlockId, CodeBlock } from "docblocks-core";

import { cn } from "../../shared/ui/cn";
import { preventDefault } from "../../shared/utils";
import { CodeHeaderActions } from "./CodeHeaderActions";
import { CodeLanguageMenu } from "./CodeLanguageMenu";

/**
 * The code block's header row: the language selector on the left (a
 * center control stands right of it — the mermaid code/preview segment)
 * and the copy / "more" controls on the right.
 *
 * Visibility: the row always occupies its space (no layout shift) and its
 * strip (the row's bottom border) is revealed while the wrapper is hovered
 * or focused (the typing state); the controls themselves reveal on a
 * hover or while one of the controls holds the keyboard focus (the row's
 * own focus-within) — the typing state (the focus in the text) keeps the
 * strip and hides the controls.
 *
 * Language: the name is always shown (default "Plain Text" — the absent
 * or empty `language` attr). The picker is a non-modal popover with a
 * search field (the typed name filters the list, Enter picks the first
 * match); a pick is an `updateBlock({ language })` (one undo step, one
 * wire update). The list is a curated base set (a consumer can override
 * the renderer for a different set).
 *
 * Copy: the block's plain text (the indentation stands, no line numbers —
 * the numbers are a rendered affordance, not text) to the clipboard; the
 * button shows the circle-check feedback for ~1.5 s (a local timer, never
 * document data).
 *
 * Collapse: the block is clamped to the first 5 line boxes with the fade
 * over the last 3 (the state is the `collapsed` attr — it syncs and
 * survives a reload); the button is DISABLED (not hidden) while the block
 * fits in the 5 lines (the logical line count — the line-break count + 1).
 *
 * Caption: seats the caret on the caption line below the block (the
 * `caption` attr; a fresh line seats the caret at the last character and
 * does nothing when the line is already focused with the caret there).
 *
 * "More": a non-modal dropdown with the two display toggles (line numbers
 * and wrap), both default ON (the absent attr reads as on); a toggle is an
 * `updateBlock` (one undo step, one wire update).
 */

interface CodeHeaderProps {
  id: BlockId;
  block: CodeBlock;
  /**
   * A control standing right of the language button (the left group) — the
   * mermaid code/preview selector, rendered by the `./mermaid` subpath.
   */
  center?: ReactNode;
}

function CodeHeader({ id, block, center }: CodeHeaderProps) {
  // The caret's inside-state (the typing's strip): the focus stands on the
  // page container over the span model, so the wrapper's focus-within never
  // stands while the code's text is typed — the state reads the caret's
  // block from the live selection instead (the anchor over the block's
  // inner).
  const [caretInside, setCaretInside] = useState(false);
  useEffect(() => {
    const onChange = () => {
      const anchor = window.getSelection()?.anchorNode ?? null;
      const element = anchor instanceof Element ? anchor : (anchor?.parentElement ?? null);
      const inner =
        element?.closest<HTMLElement>(`[data-block-id="${CSS.escape(id)}"] [data-slot="docblocks/block-content"]`) ??
        null;
      setCaretInside(inner !== null);
    };
    onChange();
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, [id]);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  // The controls' reveal: invisible (and unclickable) unless the wrapper
  // is hovered or one of the controls holds the keyboard focus (the row's
  // own focus-within — the Tab's path stands the controls with the
  // visible focus; the typing state, the focus in the text, stands the
  // strip only and keeps the controls invisible). While a header menu
  // stands open the controls stay visible: the menus are portaled
  // OUTSIDE the block, so the pointer over them loses the block hover
  // and the controls would fade away mid-use.
  const menuOpen = languageOpen || moreOpen;
  const controlClass = menuOpen
    ? "opacity-100 transition-opacity"
    : "pointer-events-none opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within/code:pointer-events-auto group-focus-within/code:opacity-100";

  return (
    <div
      data-slot="docblocks/code-header"
      contentEditable={false}
      className={cn(
        "group/code mb-1 flex items-center justify-between gap-2 border-b pb-1 text-[0.8125em]",
        // The strip's border reveal: the hover, the controls' focus, the
        // caret's inside-state (the typing), the open menus.
        caretInside || menuOpen
          ? "border-border"
          : "border-transparent group-focus-within:border-border group-hover:border-border"
      )}
      // Keep the caret: a default mousedown would move the focus out of the
      // editable (the controls are chrome, never the text).
      onMouseDown={preventDefault}
    >
      <div className={cn("flex items-center gap-1.5", controlClass)}>
        <CodeLanguageMenu id={id} block={block} open={languageOpen} onOpenChange={setLanguageOpen} />
        {center}
      </div>
      <div data-slot="docblocks/code-header-actions" className={cn("flex items-center gap-0.5", controlClass)}>
        <CodeHeaderActions id={id} block={block} open={moreOpen} onOpenChange={setMoreOpen} />
      </div>
    </div>
  );
}

export { CodeHeader };
export type { CodeHeaderProps };
