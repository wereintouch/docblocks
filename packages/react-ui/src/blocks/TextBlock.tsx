/**
 * A text block: a structural wrapper (tag and data attrs, the row chrome,
 * the nested children) around one inner contenteditable element. The
 * wrapper is never contenteditable (a nested list item must not hold other
 * blocks' text inside its own editable — the flat text diff would flatten
 * the nested text into the parent block); the inner text DOM is managed
 * imperatively from the store runs (the input commits to the doc
 * immediately, the store follows synchronously — see `useTextInner`).
 *
 * The chrome stands over the row modules: the gutter controls / checkbox /
 * quote rule / callout menu / the flat marker / the collapse toggle
 * (`TextBlockRowChrome` + `use-text-block-gestures`), the code body (the
 * line-number track + the wrap-aware scroll + the highlight layer —
 * `CodeBody`), the wrapper / inner classes + the positions' math
 * (`text-block-classes`).
 */
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";

import { useCallback, useRef } from "react";
import type { ReactNode } from "react";

import type { BlockId } from "docblocks-core";

import { useCanvasTextEdit } from "../canvas/canvas-text-edit-context";
import { useDeleteBlock } from "../editing/use-delete-block";
import { useEditorContext } from "../editor-provider";
import { useBlockContext } from "../shared/providers/block-context";
import { cn } from "../shared/ui/cn";
import { textOf, useTextInner } from "../text/text-inner";
import { CodeBody } from "./CodeBody";
import { TextBlockRowChrome } from "./TextBlockRowChrome";
import { calloutIconName } from "./callout-icon";
import { CodeCaption } from "./code/CodeCaption";
import { isHighlightable } from "./code/code-highlight";
import { indentOf, markerCycle } from "./flat";
import type { EditableBlock, TextBlockTag } from "./models";
import { alignOf, innerClassOf, wrapperClassOf } from "./text-block-classes";
import { useTextBlockGestures } from "./use-text-block-gestures";

interface TextBlockProps {
  id: BlockId;
  block: EditableBlock;
  tag: TextBlockTag;
  /** The derived nested content (a list item's sublist / the mermaid
   * preview) rendered after the editable. */
  nested?: ReactNode;
  /** A block-specific header row (the code block's header; its visibility
   * is managed by the header over the wrapper's `group` hover). */
  header?: ReactNode;
  /** A non-empty derived segment: the row shows the collapse toggle (a
   * per-instance view state, never document data). */
  collapsible?: boolean;
  /** The motion view's flat row (the `number` marker stands as a rendered
   * label — the native `ol` marker is absent over `list-style: none`). */
  flat?: boolean;
  /** The run position of a `number` item (the marker label; 1-based). */
  number?: number;
  /** Hide the code body while a renderer's display mode stands in its
   * place (the mermaid preview); the inner editable stays mounted (the
   * text-sync path). */
  codeBodyHidden?: boolean;
}

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
  const { t: tEditor } = useTranslation("editor");
  const { doc, store, commandPalettePlaceholder, viewMode } = useEditorContext();
  const deleteBlock = useDeleteBlock();
  const blockContext = useBlockContext();
  // The cell context: the block keeps its text path, but the row chrome
  // (the drag grip) and the slash-command hint do not stand in a cell.
  const inCell = blockContext.parentType === "table-cell";
  // The surface context stands neither the plus nor the grip (the
  // canvas-text is moved by the drag over its own body — the shape's
  // parity — and the plus's click would write a page paragraph into the
  // surface's z-ordered children).
  const onSurface = blockContext.parentType === "surface";
  // The canvas-text's edit session (the canvas view's state): the inner
  // stands contentEditable ONLY while the session stands; the read-only
  // stand (view / published modes) is inert over every text type.
  const canvasTextEdit = useCanvasTextEdit();
  const canvasTextEditing =
    block.type === "canvas-text" && canvasTextEdit !== null && canvasTextEdit.canvasTextEditingId === id;
  const innerIsEditable = !viewMode && (block.type !== "canvas-text" || canvasTextEditing);
  const selected = useStore(store, (state) => state.selection.kind === "blocks" && state.selection.ids.includes(id));
  const collapsed = useStore(store, (state) => state.collapsedIds.includes(id));
  // The marker's cycle index (1|2|3) from the block's indent — the
  // data-depth attr (the base view's CSS marker cycle; the motion view's
  // per-level row indent steps are the raw level).
  const cycle = markerCycle(indentOf(block));

  const wrapperRef = useRef<HTMLElement | null>(null);
  // The text-inner mechanism (the runs DOM, the input commit, the
  // gestures): the block's wrapper is the gesture root (the gutter focus
  // park and the editor-root lookups).
  const {
    innerRef,
    onInput: commitDomDelta,
    onPaste,
    onKeydown,
  } = useTextInner({
    id,
    block,
    blockType: block.type,
    context: blockContext,
    wrapperRef,
  });

  const setRefs = useCallback((element: HTMLElement | null) => {
    wrapperRef.current = element;
  }, []);

  const { onGutterClick, onGutterPlusClick, onControlMouseDown, onCollapseClick } = useTextBlockGestures({
    id,
    block,
    parentId: blockContext.parentId,
    wrapperRef,
  });

  const align = alignOf(block);
  const isCode = block.type === "code";
  // The done task's content stands at 30% opacity (the chrome stands full
  // — the editor's chrome, not the content).
  const doneTask = block.type === "list-item" && block.attrs.list === "task" && block.attrs.checked === true;

  // The callout's color / icon overrides (the null idiom — absent/null =
  // the preset per variant): the color override paints the left border + a
  // low tint (data, not theme — inline); the icon stands the preset or an
  // override by catalog name (an unknown name falls back — the lenient
  // reader).
  const calloutVariant = block.type === "callout" ? (block.attrs?.variant ?? "info") : undefined;
  const calloutColor = block.type === "callout" ? block.attrs?.color : undefined;
  const calloutColorOverride = typeof calloutColor === "string" && calloutColor !== "" ? calloutColor : undefined;
  const effectiveCalloutIcon =
    block.type === "callout" ? calloutIconName(block.attrs?.icon, calloutVariant) : undefined;
  const calloutStyle =
    block.type === "callout" && calloutColorOverride !== undefined
      ? {
          borderLeftColor: calloutColorOverride,
          background: `color-mix(in srgb, ${calloutColorOverride} var(--docblocks-callout-background-alpha), transparent)`,
        }
      : undefined;

  // The highlight layer's gate (a curated language) + the wrap (the default
  // stands for the absent attr) — the inner's classes read both.
  const highlightableCode = isCode && isHighlightable(block.attrs?.language);
  const codeWrap = isCode ? (block.attrs?.wrap ?? true) : true;

  // A flat list row's wrapper is shifted by the marker zone (the row's
  // first character stands in the row's content); the gutter and the
  // collapse columns stand at the row level — the same columns as a text
  // row of the same indent.
  const flatListShift = flat && block.type === "list-item" ? "var(--docblocks-marker-width)" : undefined;

  const classArgs = {
    block,
    tag,
    selected,
    onSurface,
    flatListShift,
    collapsed,
    doneTask,
    highlightableCode,
    codeWrap,
    calloutColorOverride,
    calloutVariant,
  };
  const wrapperClass = wrapperClassOf(classArgs);
  const innerClass = innerClassOf(classArgs);

  // The inner editable (every text type) — the code block wraps it into the
  // code body (the line-number track + the wrap-aware scroll container).
  const innerEditable = (
    <div
      ref={innerRef}
      // The canvas-text's edit session: the inner stands contentEditable
      // ONLY while the session stands (the inert inner stands no stray
      // focus, no native text selection over the drag).
      contentEditable={innerIsEditable}
      suppressContentEditableWarning
      spellCheck={false}
      data-slot="docblocks/block-content"
      data-block-id={id}
      // The empty-block hint names the slash command menu — code keeps the
      // "/" as plain text, the cell paragraphs and the canvas's box stand
      // without the hint (the ghost's hint is the entry affordance).
      data-placeholder={
        block.type === "code" || inCell || block.type === "canvas-text"
          ? undefined
          : (commandPalettePlaceholder ?? tEditor("commandPalettePlaceholder"))
      }
      className={innerClass}
      onInput={commitDomDelta}
      onPaste={onPaste}
      onBlur={
        block.type === "canvas-text"
          ? () => {
              // The edit session's close (the inner's editable's stand off
              // — the next press stands the selection again) + the empty
              // block's removal (no orphan empty boxes on the canvas —
              // the Esc-empty removal's parity; a block with text keeps
              // its box). A removed block's late blur stands the
              // getBlock's null (no double removal).
              canvasTextEdit?.setCanvasTextEditingId(null);
              if (doc.getBlock(id) !== null && doc.getTextLength(id) === 0) {
                doc.transact(() => {
                  doc.removeBlock(id);
                });
              }
            }
          : undefined
      }
    />
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
        data-callout-color={block.type === "callout" ? calloutColorOverride : undefined}
        data-callout-icon={block.type === "callout" ? effectiveCalloutIcon : undefined}
        data-language={block.type === "code" ? block.attrs?.language : undefined}
        data-align={align}
        data-depth={block.type === "list-item" ? cycle : undefined}
        data-selected={selected ? "true" : undefined}
        // No tabIndex: the wrapper stands inside the page's single editable
        // (the span model) — a focusable wrapper would stand the mousedown's
        // focus fallback's landing over the block-chrome's presses (the
        // browser focuses the nearest focusable element when the control's
        // focus default is suppressed), and a focus inside the editable
        // seats a caret (the selection's mapping would then clobber the
        // blocks' view). The keys stand over the container's focus (the
        // page surface's dispatch) or the editor root's park.
        className={cn("group", wrapperClass)}
        style={calloutStyle}
        onKeyDown={onKeydown}
      >
        {header}
        <TextBlockRowChrome
          id={id}
          block={block}
          cycle={cycle}
          number={number}
          flat={flat}
          flatListShift={flatListShift}
          collapsed={collapsed}
          selected={selected}
          inCell={inCell}
          onSurface={onSurface}
          viewMode={viewMode}
          collapsible={collapsible}
          doc={doc}
          deleteBlock={deleteBlock}
          onGutterClick={onGutterClick}
          onGutterPlusClick={onGutterPlusClick}
          onControlMouseDown={onControlMouseDown}
          onCollapseClick={onCollapseClick}
        />
        {isCode ? (
          <CodeBody
            id={id}
            block={block}
            codeBodyHidden={codeBodyHidden}
            innerRef={innerRef}
            innerEditable={innerEditable}
          />
        ) : (
          innerEditable
        )}
        {nested}
      </Tag>
      {isCode ? <CodeCaption id={id} block={block} /> : null}
    </>
  );
}

export { TextBlock, textOf };
export type { EditableBlock, TextBlockProps, TextBlockTag };
