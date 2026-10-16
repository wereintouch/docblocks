import { useStore } from "zustand";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";

import type { Block, BlockId, TextRun } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import {
  caretOffsetIn,
  logicalTextOf,
  restoreSelection,
  selectionInside,
  selectionOrphaned,
} from "../editing/dom-offset";
import { useBlockInput } from "../editing/input-safety";
import { useBlockKeyboard } from "../editing/keyboard";
import { useSlashMenuApi } from "../editing/slash";
import { diffTexts, rebaseOffset } from "../editing/text-diff";
import { Button } from "../shared/ui/Button";
import { Checkbox } from "../shared/ui/Checkbox";
import { cn } from "../shared/ui/cn";
import { GripVertical, TriangleFilled } from "../shared/ui/icons";
import { renderRunsInto } from "../text/runs-dom";
import { CodeCaption } from "./CodeCaption";
import { useBlockContext } from "./block-context";
import { measureCodeLines } from "./code-metrics";
import type { CodeLineMetric } from "./code-metrics";
import { indentOf, markerCycle, numberMarkerLabel } from "./flat";

/** The text-editable block types (the wrapper tag and data attrs are props). */
type EditableBlock = Extract<
  Block,
  { type: "paragraph" | "quote" | "heading" | "callout" | "list-item" | "code" | "latex" | "canvas-text" }
>;

interface TextBlockProps {
  id: BlockId;
  block: EditableBlock;
  tag: "div" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "aside" | "li" | "pre";
  /**
   * Content rendered inside the wrapper after the editable: the derived
   * nested content (the flat model's "children" — a list item's sublist /
   * a text container's nested slot; a list item's content self-gates on
   * the collapse state) or a custom trailing region (the mermaid diagram
   * preview).
   */
  nested?: ReactNode;
  /**
   * A block-specific header row rendered as the wrapper's first child
   * (the code block's header; its visibility is managed by the header
   * itself through the wrapper's `group` hover / focus state).
   */
  header?: ReactNode;
  /**
   * A block with a non-empty derived segment (the flat model's
   * "children"): the row shows the collapse toggle (a per-instance view
   * state, never document data).
   */
  collapsible?: boolean;
  /**
   * The motion view's flat row: the `number` item's marker stands as a
   * rendered label (the flat row is `list-style: none` — the native `ol`
   * marker is absent; the base view numbers the `ol` natively).
   */
  flat?: boolean;
  /** The run position of a `number` item (the marker label; 1-based). */
  number?: number;
  /**
   * Hide the code body (the number track + the scroll container) while a
   * renderer's display mode stands in its place (the mermaid preview).
   * The inner editable stays mounted — the text-sync path — but cannot
   * take focus while hidden.
   */
  codeBodyHidden?: boolean;
}

/** The code body's collapsed clamp: the first 5 line boxes + the fade over the last 3 (the token-based calc). */
const COLLAPSED_CLAMP: CSSProperties = {
  maxHeight: "calc(5 * var(--docblocks-line-box-height))",
  overflow: "hidden",
  maskImage: "linear-gradient(to bottom, #000 calc(100% - 3 * var(--docblocks-line-box-height)), transparent 100%)",
  WebkitMaskImage:
    "linear-gradient(to bottom, #000 calc(100% - 3 * var(--docblocks-line-box-height)), transparent 100%)",
};

/** Whether two measured line layouts agree (the metrics re-measure guard). */
function sameMetrics(a: CodeLineMetric[] | null, b: CodeLineMetric[] | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined || x.top !== y.top || x.height !== y.height) return false;
  }
  return true;
}

const EMPTY_RUNS: TextRun[] = [];

/** The flattened text of the runs. */
function textOf(runs: TextRun[] | undefined): string {
  if (runs === undefined) return "";
  return runs.reduce((text, run) => text + run.text, "");
}

/**
 * The horizontal text alignment for the data attribute (absent = left, the
 * default). Code and canvas-text carry their own alignment model (none and
 * the `textAlign` attr), so they never expose `data-align`.
 */
function alignOf(block: EditableBlock): "left" | "center" | "right" | undefined {
  if (block.type === "code" || block.type === "canvas-text") return undefined;
  return "attrs" in block ? block.attrs?.align : undefined;
}

/**
 * A text block: a structural wrapper (tag and data attrs, the gutter
 * handle, the nested children) around one inner contenteditable element.
 *
 * The wrapper is never contenteditable: a nested list item must not hold
 * other blocks' text inside its own editable, or the flat text diff would
 * flatten the nested text into the parent block. React renders only the
 * two elements; the inner text DOM is managed imperatively from the store
 * runs, because a React-managed child tree cannot be reconciled over a DOM
 * the browser edits. While the DOM selection is inside the inner element
 * (the block is focused) the browser owns the text DOM: every input is
 * committed to the doc immediately, and the store (the doc's projection)
 * follows synchronously, so the DOM and the doc always agree. A store
 * text change that reaches the block while the selection is inside (a
 * remote or undo change — the previous store text equals the DOM text)
 * rebuilds the text DOM from the new runs and restores the selection
 * rebased across the store-text delta; a mark/attrs-only change
 * re-renders the runs in place (the applied formatting is visible
 * without leaving the block) and restores the selection as-is. When the
 * selection leaves the
 * block, the text DOM is re-synced from the store (the doc is the source
 * of truth; a lagging DOM — e.g. after an undo while editing — is
 * discarded, never committed back). Enter/Shift+Enter, Backspace-at-0,
 * Tab/Shift+Tab, and paste are guarded (useBlockInput): the line-split
 * default is suppressed, the gestures issue doc commands, and paste
 * commits plain text. Known v1 limitation: CJK IME composition is not
 * tracked (composition commits character by character).
 *
 * The collapse toggle (any block with a derived segment) and the checkbox
 * are view affordances:
 * a per-instance state (the store's collapsedIds / the block's `checked`
 * attr) — the toggle is never document data, and while collapsed the
 * derived segment is unmounted (the other panes stand).
 *
 * The `number` marker in the flat (motion) view: a rendered label per
 * level (decimal / lower-alpha / lower-roman, cycled by the marker's
 * cycle index), from the run position (continuing across the sublist).
 */
function TextBlock({
  id,
  block,
  tag,
  nested,
  collapsible = false,
  flat = false,
  number,
  header,
  codeBodyHidden = false,
}: TextBlockProps) {
  const { doc, store, selection: selectionRef, commandPalettePlaceholder } = useEditorContext();
  const blockContext = useBlockContext();
  const selected = useStore(store, (state) => state.selection.kind === "blocks" && state.selection.ids.includes(id));
  const collapsed = useStore(store, (state) => state.collapsedIds.includes(id));
  // The marker's cycle index (1|2|3) from the block's indent — the
  // data-depth attr (the base view's CSS marker cycle; the motion view's
  // per-level row indent steps are the raw level).
  const cycle = markerCycle(indentOf(block));
  // The flat (motion) row's rendered list marker: the base view numbers /
  // bullets through the native `ol`/`ul` list-style, but a flat row is not
  // in a list element, so the marker is a rendered span. A `number` item
  // carries its run-position label (decimal / lower-alpha / lower-roman,
  // cycled by the marker's cycle); a `bullet` item is an empty span the
  // stylesheet's ::before glyph fills per data-cycle. A `task` item has
  // no marker (the checkbox stands in for it).
  const flatMarkerIsNumber = flat && block.type === "list-item" && block.attrs.list === "number";
  const flatMarkerIsBullet = flat && block.type === "list-item" && block.attrs.list === "bullet";

  const wrapperRef = useRef<HTMLElement | null>(null);
  const innerRef = useRef<HTMLElement | null>(null);
  const slash = useSlashMenuApi();
  /**
   * The caret a local gesture wants restored after the store-driven
   * rebuild (a flat offset in the new text); consumed by the next
   * post-render commit.
   */
  const localCaretRef = useRef<number | null>(null);
  /** The local-caret declaration for the input gestures of this block. */
  const declareLocalCaret = useCallback((offset: number) => {
    localCaretRef.current = offset;
  }, []);
  const { onKeyDown: onInputKeyDown, onPaste } = useBlockInput({
    id,
    blockType: block.type,
    context: blockContext,
    innerRef,
    wrapperRef,
    declareLocalCaret,
  });
  const { onKeyDown: onGestureKeyDown } = useBlockKeyboard({
    id,
    blockType: block.type,
    context: blockContext,
    innerRef,
  });

  /**
   * The block's single keydown entry: the open slash menu first (it owns
   * the keys while open), then the keyboard gestures, then the input-
   * safety guards (skipped when a handler already prevented the default,
   * so preventDefault is never doubled).
   */
  const onKeydown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (slash !== null && slash.onKeyDown(event, id)) return;
      onGestureKeyDown(event);
      if (event.defaultPrevented) return;
      onInputKeyDown(event);
    },
    [id, onGestureKeyDown, onInputKeyDown, slash]
  );

  /** The last store block snapshot applied to the text DOM. */
  const appliedRef = useRef<Block | null>(null);
  /** A store text change pending for the post-render rebuild (selection inside). */
  const pendingRef = useRef<{ runs: TextRun[]; restore: { from: number; to: number | null } | null } | null>(null);

  const storeRuns = block.content ?? EMPTY_RUNS;

  /** Commit the DOM text as a delta over the store text (one undo step). */
  const commitDomDelta = useCallback(() => {
    const el = innerRef.current;
    if (el === null) return;
    // A cross-block range is owned by the range operations: a cross DOM
    // selection must not feed the single-region diff (it would commit a
    // garbage region — the store stays the source of truth).
    const selection = selectionRef.view?.get();
    if (selection?.kind === "text" && selection.to !== null && selection.to.blockId !== selection.from.blockId) {
      return;
    }
    const current = store.getState().blocks[id];
    if (current === undefined) return;
    const delta = diffTexts(textOf("content" in current ? current.content : undefined), logicalTextOf(el));
    if (delta === null) return;
    doc.transact(() => {
      if (delta.deleteLen > 0) doc.deleteText(id, delta.from, delta.from + delta.deleteLen);
      if (delta.inserted.length > 0) doc.insertText(id, delta.from, delta.inserted);
    });
  }, [doc, id, selectionRef, store]);

  // Capture a store block change that reaches while the DOM selection is
  // inside, before the render: zustand notifies synchronously in the doc
  // change handler, so the DOM still holds the text the selection was
  // captured against here. A text change rebases the captured selection
  // across the delta; a mark/attrs-only change re-renders the runs in
  // place (the applied formatting must be visible without leaving the
  // block), restoring the selection as-is.
  useEffect(() => {
    const unsubscribe = store.subscribe((state, prevState) => {
      const nextBlock = state.blocks[id];
      const prevBlock = prevState.blocks[id];
      if (nextBlock === prevBlock) return;
      const nextText = nextBlock !== undefined && "content" in nextBlock ? textOf(nextBlock.content) : "";
      const prevText = prevBlock !== undefined && "content" in prevBlock ? textOf(prevBlock.content) : "";

      const el = innerRef.current;
      const selection = window.getSelection();
      if (el === null || selection === null || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return;

      const from = caretOffsetIn(el, range.startContainer, range.startOffset);
      const to = caretOffsetIn(el, range.endContainer, range.endOffset);
      if (nextText === prevText) {
        // Mark/attrs-only change: the text stands, the selection is
        // restored in place (the offsets are valid against the same text).
        pendingRef.current = {
          runs: nextBlock !== undefined && "content" in nextBlock ? (nextBlock.content ?? EMPTY_RUNS) : EMPTY_RUNS,
          restore: { from, to: to === from ? null : to },
        };
        return;
      }
      if (logicalTextOf(el) === nextText) return; // this block's own input: the DOM already holds the new text

      // A remote/undo change: rebuild from the new runs and rebase the
      // captured selection across the store-text delta.
      const delta = diffTexts(prevText, nextText);
      if (delta === null) return;
      const runs = nextBlock !== undefined && "content" in nextBlock ? (nextBlock.content ?? EMPTY_RUNS) : EMPTY_RUNS;
      pendingRef.current = {
        runs,
        restore: { from: rebaseOffset(from, delta), to: to === from ? null : rebaseOffset(to, delta) },
      };
    });
    return unsubscribe;
  }, [id, store]);

  // After the commit: apply the pending rebuild (selection was inside) or
  // re-sync the text DOM from the store whenever the block snapshot
  // changed and the selection is not inside (mount seed included). "Inside"
  // is read from the live DOM selection at apply time, never from a stale
  // focus flag.
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (el === null) return;
    const pending = pendingRef.current;
    const override = localCaretRef.current;
    localCaretRef.current = null;
    if (pending !== null) {
      pendingRef.current = null;
      renderRunsInto(pending.runs, el);
      appliedRef.current = block;
      // The selection may have left the block between the capture and
      // this commit — then the rebuild alone is the convergence. An
      // orphaned selection (its containers detached by the rebuild above)
      // still belongs to this block: the restore is the recovery. A
      // local-caret declaration replaces the rebased offsets (the caret
      // is a collapsed point: no range).
      if (pending.restore !== null && (selectionInside(el) || selectionOrphaned())) {
        restoreSelection(el, override ?? pending.restore.from, override !== null ? null : pending.restore.to);
      }
      return;
    }
    if (!selectionInside(el) && appliedRef.current !== block) {
      renderRunsInto(storeRuns, el);
      appliedRef.current = block;
    }
  });

  const setRefs = useCallback((element: HTMLElement | null) => {
    wrapperRef.current = element;
  }, []);
  const setInnerRef = useCallback((element: HTMLElement | null) => {
    innerRef.current = element;
  }, []);

  // The code block's logical line metrics (the line-number anchors): the
  // line boxes measured against the inner's live DOM after every render
  // (a text / attr / selection re-render re-runs the measure; the guard
  // keeps the metrics reference stable while the layout stands) and on a
  // width change (the wrap reflows the lines).
  const isCode = block.type === "code";
  const [lineMetrics, setLineMetrics] = useState<CodeLineMetric[] | null>(null);
  useLayoutEffect(() => {
    if (!isCode) return;
    const inner = innerRef.current;
    if (inner === null) return;
    const next = measureCodeLines(inner, textOf(block.content));
    setLineMetrics((prev) => (sameMetrics(prev, next) ? prev : next));
  });
  useEffect(() => {
    if (!isCode || typeof ResizeObserver === "undefined") return;
    const inner = innerRef.current;
    if (inner === null) return;
    const observer = new ResizeObserver(() => {
      const current = store.getState().blocks[id];
      if (current === undefined || "content" in current === false) return;
      const next = measureCodeLines(inner, textOf(current.content));
      setLineMetrics((prev) => (sameMetrics(prev, next) ? prev : next));
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, [id, isCode, store]);

  /** Gutter click: a blocks selection on this block (Shift extends from the previous anchor). */
  const onGutterClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      const view = selectionRef.view;
      if (view === null) return;
      const current = view.get();
      if (event.shiftKey && current.kind === "blocks") {
        const siblings = doc.getChildren(blockContext.parentId);
        const anchorIndex = siblings.indexOf(current.anchorId);
        const hereIndex = siblings.indexOf(id);
        // Same parent only; a cross-parent range is a v1.1 feature.
        if (anchorIndex !== -1 && hereIndex !== -1) {
          const [low, high] = anchorIndex <= hereIndex ? [anchorIndex, hereIndex] : [hereIndex, anchorIndex];
          view.set({ kind: "blocks", ids: siblings.slice(low, high + 1), anchorId: current.anchorId });
        } else {
          view.set({ kind: "blocks", ids: [id], anchorId: id });
        }
      } else {
        view.set({ kind: "blocks", ids: [id], anchorId: id });
      }
      wrapperRef.current?.focus();
    },
    [blockContext, doc, id, selectionRef]
  );

  /** Keep a mousedown on a block control from moving the text caret. */
  const onControlMouseDown = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
  }, []);

  /**
   * Collapse toggle: a view-state flip (no doc command, no wire update,
   * not in the undo history) — the children unmount while hidden.
   */
  const onCollapseClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      const state = store.getState();
      state.setCollapsed(id, !state.collapsedIds.includes(id));
    },
    [id, store]
  );

  const align = alignOf(block);

  // The code body state: the logical lines (the line-number rows and the
  // collapsed clamp count), the wrap (the default stands for the absent
  // attr), and the collapsed clamp (the absent attr reads as expanded).
  const codeLines = isCode ? textOf(block.content).split("\n").length : 0;
  const codeWrap = isCode ? (block.attrs?.wrap ?? true) : true;
  const codeCollapsed = isCode && block.attrs?.collapsed === true;
  const codeLineNumbers = isCode ? (block.attrs?.lineNumbers ?? true) : false;

  /**
   * The wrapper classes: the gutter positioning box (no focus outline).
   * Non-list blocks carry the vertical spacing (a list item's spacing
   * stands on its list); the selected background follows the blocks
   * selection; the heading weight and the h1-h3 sizes follow the heading
   * tokens.
   */
  const headingSize =
    block.type === "heading" && tag === "h1"
      ? "text-(length:--docblocks-heading-h1-font-size)"
      : block.type === "heading" && tag === "h2"
        ? "text-(length:--docblocks-heading-h2-font-size)"
        : block.type === "heading" && tag === "h3"
          ? "text-(length:--docblocks-heading-h3-font-size)"
          : undefined;
  // The block's wrapper classes (the old [data-slot="docblocks/block"]
  // rules as utilities). The selected background precedes the block-type
  // backgrounds: the merge drops it for a callout or code block (their
  // background wins — the way the unlayered callout/code CSS beat the
  // layered utility before this migration).
  const wrapperClass = cn(
    "relative outline-none",
    tag !== "li" && "my-(--docblocks-block-spacing)",
    selected && "bg-(--docblocks-selected-background)",
    block.type === "heading" && "font-(--docblocks-heading-font-weight)",
    headingSize,
    block.type === "callout" &&
      cn(
        "border-l-(length:--docblocks-callout-border-width) border-l-(--docblocks-callout-border-color-info)",
        "rounded-(--docblocks-radius) bg-(--docblocks-callout-background-info) p-(--docblocks-callout-padding)"
      ),
    block.type === "callout" &&
      block.attrs?.variant === "warning" &&
      cn("border-l-(--docblocks-callout-border-color-warning)", "bg-(--docblocks-callout-background-warning)"),
    block.type === "callout" &&
      block.attrs?.variant === "danger" &&
      cn("border-l-(--docblocks-callout-border-color-danger)", "bg-(--docblocks-callout-background-danger)"),
    block.type === "code" &&
      "rounded-(--docblocks-radius) bg-(--docblocks-code-background) p-(--docblocks-code-padding)",
    // The quote's marker zone: the left rule stands in the 20px zone left
    // of the text (the list rows' checkbox / number axis) — the wrapper's
    // own padding (every view, the rows add no zone padding for it).
    block.type === "quote" && "pl-(--docblocks-marker-width)"
  );

  /**
   * The inner editable classes: no spacing of its own, the pre-wrap of the
   * line breaks, the zero-width line box of an empty editable (the caret
   * target — the pseudo-element content is not text content), the done
   * task's strike, and the block's alignment (left is the default).
   */
  const innerClass = cn(
    "m-0 whitespace-pre-wrap outline-none empty:after:content-['\\200b']",
    block.type === "list-item" && block.attrs.checked && "line-through",
    (block.type === "code" || block.type === "latex") && "font-(family-name:--docblocks-mono-font-family)",
    align === "center" && "text-center",
    align === "right" && "text-right",
    // The wrap-OFF code: single-line rows + the horizontal scrollbar (the
    // code-scroll container below scrolls; the wrap-ON default wraps).
    block.type === "code" && !codeWrap && "whitespace-pre"
  );

  // The inner editable (every text type) — the code block wraps it into the
  // code body (the line-number track + the wrap-aware scroll container).
  const innerEditable = (
    <div
      ref={setInnerRef}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      data-slot="docblocks/block-content"
      data-block-id={id}
      data-placeholder={commandPalettePlaceholder}
      className={innerClass}
      onInput={commitDomDelta}
      onPaste={onPaste}
    />
  );
  const codeBody = isCode ? (
    <div
      data-slot="docblocks/code-body"
      className={cn("flex min-w-0", codeBodyHidden && "hidden")}
      style={codeCollapsed ? COLLAPSED_CLAMP : undefined}
    >
      {codeLineNumbers && (
        <div
          data-slot="docblocks/code-line-numbers"
          aria-hidden
          className="
            relative w-10 shrink-0 pr-2 text-right font-(family-name:--docblocks-mono-font-family) text-muted-foreground
            select-none
          "
        >
          {lineMetrics === null
            ? Array.from({ length: codeLines }, (_, i) => <div key={i}>{i + 1}</div>)
            : lineMetrics.map((metric, i) => (
                <span key={i} className="absolute block" style={{ top: metric.top, height: metric.height }}>
                  {i + 1}
                </span>
              ))}
        </div>
      )}
      <div data-slot="docblocks/code-scroll" className={cn("min-w-0 flex-1", !codeWrap && "overflow-x-auto")}>
        {innerEditable}
      </div>
    </div>
  ) : (
    innerEditable
  );

  /**
   * The gutter handle classes: the grip control in the left margin (the
   * position reads the gutter tokens), revealed on a wrapper hover or while
   * the block is selected. Centered on the FIRST line (not the block's
   * vertical middle): a multi-line block keeps the grip at the line level.
   */
  const gutterClass = cn(
    "absolute top-[calc((var(--docblocks-line-box-height)-var(--docblocks-gutter-size))/2)]",
    "cursor-pointer rounded-full opacity-0 group-hover:opacity-100",
    "left-(--docblocks-gutter-left) text-(--docblocks-gutter-color)",
    selected && "opacity-100"
  );

  /**
   * A flat list row's wrapper is shifted by the marker zone (the row's
   * first character stands in the row's content); the gutter and the
   * collapse columns stand at the row level — the same columns as a text
   * row of the same indent.
   */
  const flatListShift = flat && block.type === "list-item" ? "var(--docblocks-marker-width)" : undefined;
  const gutterShift =
    flatListShift === undefined ? undefined : { left: `calc(var(--docblocks-gutter-left) - ${flatListShift})` };

  /**
   * The task checkbox position (the list marker gutter; the Checkbox
   * primitive sizes itself). Centered on the first line like the gutter
   * band: the checkbox's box stands in the first line box, on the same
   * axis as the row text.
   */
  const checkboxClass =
    "absolute left-(--docblocks-checkbox-left) top-[calc((var(--docblocks-line-box-height)-var(--docblocks-checkbox-size))/2)]";

  /**
   * The collapse toggle: between the drag grip and the block content, in
   * the gutter band (every view), centered on the first line on the same
   * axis as the grip (a multi-line block keeps both at the line level). The
   * triangle is filled in both states —
   * pointing right while collapsed, down while expanded — in the block's
   * text color (the gutter's muted stands for the grip only). The hover
   * highlight is the muted square (rounded-xs) behind the triangle. The
   * collapsed state is always visible; the expanded state reveals on a
   * wrapper hover, like the grip. The ghost variant's hover colors are
   * pinned back to the same values. `text-[length:inherit]` keeps the em
   * basis on the block's font (the Button base carries text-sm).
   */
  const collapseClass = cn(
    "absolute top-[calc((var(--docblocks-line-box-height)-var(--docblocks-collapse-size))/2)]",
    "size-5 cursor-pointer rounded-xs text-[length:inherit]",
    "left-(--docblocks-collapse-band-left)",
    "text-(--docblocks-text-color) hover:text-(--docblocks-text-color) dark:hover:text-(--docblocks-text-color)",
    "hover:bg-muted dark:hover:bg-muted",
    !collapsed && "opacity-0 group-hover:opacity-100"
  );

  const Tag = tag;
  return (
    <>
      <Tag
        ref={setRefs}
        data-slot={tag === "li" ? "docblocks/list-item" : "docblocks/block"}
        data-block-type={block.type}
        data-block-id={id}
        data-list={block.type === "list-item" ? block.attrs.list : undefined}
        data-checked={block.type === "list-item" ? block.attrs.checked : undefined}
        data-variant={block.type === "callout" ? block.attrs?.variant : undefined}
        data-language={block.type === "code" ? block.attrs?.language : undefined}
        data-display={block.type === "latex" ? (block.attrs.display ? "true" : "false") : undefined}
        data-align={alignOf(block)}
        data-depth={block.type === "list-item" ? cycle : undefined}
        data-selected={selected ? "true" : undefined}
        tabIndex={0}
        className={cn("group", wrapperClass)}
        onKeyDown={onKeydown}
      >
        {header}
        <Button
          type="button"
          data-slot="docblocks/gutter"
          aria-label="Select block"
          variant="ghost"
          size="icon"
          onClick={onGutterClick}
          onMouseDown={onControlMouseDown}
          className={cn(gutterClass, "size-5")}
          style={gutterShift}
        >
          <GripVertical />
        </Button>
        {block.type === "list-item" && block.attrs.list === "task" && (
          <Checkbox
            data-slot="docblocks/checkbox"
            checked={block.attrs.checked === true}
            aria-label={block.attrs.checked ? "Mark task as not done" : "Mark task as done"}
            // One command is its own transaction: one undo step, one wire update.
            onCheckedChange={(checked) => {
              doc.updateBlock(id, { checked: checked === true });
            }}
            onMouseDown={onControlMouseDown}
            className={checkboxClass}
          />
        )}
        {block.type === "quote" && (
          <div
            data-slot="docblocks/quote-rule"
            aria-hidden
            className="
              pointer-events-none absolute top-0 bottom-0 left-0 w-(--docblocks-quote-border-width)
              bg-(--docblocks-quote-border-color)
            "
          />
        )}
        {(flatMarkerIsNumber || flatMarkerIsBullet) && (
          <span data-slot="docblocks/row-marker" data-cycle={cycle} data-kind={block.attrs.list}>
            {flatMarkerIsNumber && number !== undefined ? numberMarkerLabel(number, cycle) : null}
          </span>
        )}
        {collapsible && (
          <Button
            type="button"
            data-slot="docblocks/collapse"
            aria-label={collapsed ? "Expand children" : "Collapse children"}
            aria-expanded={!collapsed}
            variant="ghost"
            // A view-state flip (no doc command, no wire update, not in the
            // undo history) — the children unmount while hidden.
            onClick={onCollapseClick}
            onMouseDown={onControlMouseDown}
            className={cn(collapseClass, "p-0 has-[>svg]:p-0")}
            style={
              flatListShift === undefined
                ? undefined
                : { left: `calc(var(--docblocks-collapse-band-left) - ${flatListShift})` }
            }
          >
            <TriangleFilled className={cn("size-2", collapsed ? "rotate-90" : "rotate-180")} />
          </Button>
        )}
        {codeBody}
        {nested}
      </Tag>
      {isCode ? <CodeCaption id={id} block={block} /> : null}
    </>
  );
}

export { TextBlock, textOf };
export type { EditableBlock, TextBlockProps };
