/**
 * The canvas ghost text block (the double-click's empty-canvas entry): the
 * focused contenteditable at the point (the top-left anchor, the text
 * tool's default box — the world's space, so it scales with the zoom)
 * with the blinking caret — nothing is written until the first input.
 * The first input (the non-composition `input`; the CJK's compositionend
 * stands the same stand) commits in a single `doc.transact` (the insert + the
 * geometry — the default box's center over the top-left point — + the
 * text); the ghost closes and the caret seats into the real block's inner
 * (the offset 0's stand). The Escape (the ghost's own keydown — the
 * canvas's keys stand no stand of its own) and the blur without input
 * cancel: nothing is written. Pure view state — no data, no awareness.
 */
import { useEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import type { BlockId } from "docblocks-core";

import { firstSurface } from "../../canvas";
import { focusCaretIn } from "../../editing/block-commands";
import { editorRootOf } from "../../editing/dom-offset";
import { useEditorContext } from "../../editor-provider";
import { TOOL_SIZES } from "../viewport";

function CanvasTextGhost({ point, onClose }: { point: { x: number; y: number }; onClose: () => void }) {
  const { doc } = useEditorContext();
  // The text tool's default box (the committed block's size — the
  // geometry's center stands it over the top-left's point).
  const size = TOOL_SIZES.text;
  const ref = useRef<HTMLDivElement | null>(null);
  // The commit's single-write guard: the input / the compositionend / the
  // blur's stands must write the block once (the composition's input pair
  // fires both).
  const committedRef = useRef(false);

  // The caret's autofocus (the ghost's stand over the mount — the native
  // blink).
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    el.focus();
    const selection = window.getSelection();
    if (selection === null) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(true); // the offset 0's stand
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  /**
   * The commit (the first input's stand) or the cancel (the empty text's
   * stand — the blur / the compositionend over the deleted draft): the
   * write is a single transact (one undo step, one wire update).
   */
  const close = (text: string) => {
    if (committedRef.current) return;
    committedRef.current = true;
    if (text.length === 0) {
      onClose(); // the cancel: nothing is written
      return;
    }
    const surface = firstSurface(doc);
    let id: BlockId | null = null;
    try {
      doc.transact(() => {
        id = doc.insertBlock("canvas-text", undefined, { parent: surface });
        doc.setGeometry(id, {
          x: point.x + size.w / 2,
          y: point.y + size.h / 2,
          w: size.w,
          h: size.h,
        });
        doc.insertText(id, 0, text);
      });
    } catch {
      // A rejected placement (a validator rejection): the ghost stands
      // (the input's retry).
      committedRef.current = false;
      return;
    }
    onClose();
    const scope = ref.current !== null ? editorRootOf(ref.current) : document;
    // The caret re-seats AFTER the committed text (the text's end): the
    // fast typing's continuation stands over the re-seated caret (a
    // re-seat at the text's start would prepend the continuation over the
    // committed stand, scrambling the stand).
    focusCaretIn(id!, text.length, scope);
  };

  /** The compositionend's commit (the CJK's candidate's stand). */
  const onCompositionEnd = () => {
    const el = ref.current;
    if (el === null) return;
    close(el.innerText ?? el.textContent ?? "");
  };

  /** The Escape's cancel: nothing is written (the committed flag keeps
   * the unmount's blur stand off); the stopPropagation keeps the
   * canvas-level's Escape off (the canvas's keys never run over the
   * ghost). */
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    committedRef.current = true;
    onClose();
  };

  /** The blur's cancel (the nothing-written's stand — the input's stands
   * commit on the keystroke, so a texted blur is the committed stand). */
  const onBlur = () => {
    const el = ref.current;
    if (el === null) return;
    close(el.innerText ?? el.textContent ?? "");
  };

  return (
    <div
      data-slot="docblocks/canvas-text-ghost"
      className="absolute"
      style={{
        // The top-left's anchor (the dblclick's point's stand — the
        // world's center-relative coords, the items' parity).
        left: `calc(50% + ${point.x}px)`,
        top: `calc(50% + ${point.y}px)`,
        width: size.w,
        height: size.h,
      }}
    >
      {/* The editor's default text stand (the inherited font / color /
          size — the canvas-text's inner's resting style, the committed
          block's continuity). */}
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        data-slot="docblocks/canvas-text-ghost-inner"
        className="h-full w-full whitespace-pre-wrap outline-none"
        onInput={(event) => {
          // The composing input stands no commit (the CJK's
          // compositionend's stand — the same single-transact's path).
          if ((event.nativeEvent as InputEvent).isComposing) return;
          const el = ref.current;
          if (el === null) return;
          // innerText maps the <br> soft breaks to \n (the read stand);
          // textContent is the jsdom fallback (innerText stands layout-only).
          close(el.innerText ?? el.textContent ?? "");
        }}
        onCompositionEnd={onCompositionEnd}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      />
    </div>
  );
}

export { CanvasTextGhost };
