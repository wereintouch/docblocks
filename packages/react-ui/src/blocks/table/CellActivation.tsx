/** The empty-cell activation layer (moved verbatim from the table's cell
 * renderers): a local contenteditable that holds the caret while the cell
 * holds no blocks. Nothing is written to the doc while the layer stands
 * (the cell stays data-empty — no wire traffic); the FIRST input (or
 * paste) materializes a paragraph with the typed text in one transaction
 * (one undo step, one wire update). When a paragraph arrives concurrently
 * (a peer activated the same cell before the input committed), the input
 * lands in the existing first paragraph instead of inserting a new one —
 * the empty paragraphs do not multiply.
 *
 * The layer's own content is never doc-derived (the store rebuild swaps it
 * for the real paragraph as soon as the cell holds one), so the input
 * commits the whole textContent and clears the local DOM; the caret re-
 * seats in the materialized paragraph on the next frame. A first input
 * mid-IME-composition materializes the paragraph and unmounts the layer,
 * canceling the composition session — the v1 IME limitation stands (the
 * text-block layer carries the same known limit).
 */
import { useRef } from "react";
import type { ClipboardEvent, KeyboardEvent } from "react";

import type { BlockId } from "docblocks-core";

import { focusCaretIn } from "../../editing/block-commands";
import { plainTextOfHtml } from "../../editing/clipboard";
import { useEditorContext } from "../../editor-provider";

/**
 * The empty-cell activation layer: a local contenteditable that holds the
 * caret while the cell holds no blocks. Nothing is written to the doc while
 * the layer stands (the cell stays data-empty — no wire traffic); the
 * FIRST input (or paste) materializes a paragraph with the typed text in
 * one transaction (one undo step, one wire update). When a paragraph
 * arrives concurrently (a peer activated the same cell before the input
 * committed), the input lands in the existing first paragraph instead of
 * inserting a new one — the empty paragraphs do not multiply.
 *
 * The layer's own content is never doc-derived (the store rebuild swaps it
 * for the real paragraph as soon as the cell holds one), so the input
 * commits the whole textContent and clears the local DOM; the caret re-
 * seats in the materialized paragraph on the next frame. A first input
 * mid-IME-composition materializes the paragraph and unmounts the layer,
 * canceling the composition session — the v1 IME limitation stands (the
 * text-block layer carries the same known limit).
 */
function CellActivation({ cellId }: { cellId: BlockId }) {
  const { doc } = useEditorContext();
  const ref = useRef<HTMLDivElement | null>(null);

  /**
   * Materializes the paragraph with `content` (or merges into a
   * concurrently arrived one) and seats the caret at its end on the next
   * frame (the store-driven swap renders the real paragraph first).
   */
  const materialize = (content: string) => {
    const scope = ref.current?.closest<HTMLElement>('[data-slot="docblocks/editor"]') ?? document;
    // The seat target survives the transact via a property (a closure-
    // assigned variable is not flow-narrowed past the call).
    const seat: { target: { blockId: BlockId; offset: number } | null } = { target: null };
    try {
      doc.transact(() => {
        const children = doc.getChildren(cellId);
        if (children.length === 0) {
          const paragraph = doc.insertBlock("paragraph", undefined, { parent: cellId });
          doc.insertText(paragraph, 0, content);
          seat.target = { blockId: paragraph, offset: content.length };
        } else {
          const first = children[0]!;
          const length = doc.getTextLength(first);
          doc.insertText(first, length, content);
          seat.target = { blockId: first, offset: length + content.length };
        }
      });
    } catch {
      // A rejected insertion (the cell re-parented mid-gesture): the local
      // text is restored into the layer and the gesture is a no-op.
      const el = ref.current;
      if (el !== null) el.textContent = content;
      return;
    }
    if (seat.target !== null) focusCaretIn(seat.target.blockId, seat.target.offset, scope);
  };

  const onInput = () => {
    const el = ref.current;
    if (el === null) return;
    const text = el.textContent ?? "";
    el.textContent = "";
    if (text === "") return;
    materialize(text);
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    // The cell paste is plain text only (the markdown pipeline degrades to
    // a single paragraph in a cell; the browser's rich insertion is
    // suppressed): multi-line text stands as soft breaks; an HTML-only
    // payload degrades to its text (the marks are dropped).
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    const html = event.clipboardData.getData("text/html");
    const plain = text !== "" ? text : html !== "" ? plainTextOfHtml(html) : "";
    if (plain === "") return;
    materialize(plain.replace(/\r\n?/g, "\n"));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Enter in a cell is a soft line break; the empty layer has no block to
    // break, so the key is a no-op (the browser's <div>/<br> insertion is
    // suppressed — the layer stays content-free until the first input).
    // An IME-composed Enter commits the candidate and flows to onInput.
    if (event.key === "Enter" && !event.nativeEvent.isComposing) event.preventDefault();
  };

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      data-slot="docblocks/cell-activation"
      className="m-0 min-w-full whitespace-pre-wrap outline-none"
      onInput={onInput}
      onPaste={onPaste}
      onKeyDown={onKeyDown}
    />
  );
}

export { CellActivation };
