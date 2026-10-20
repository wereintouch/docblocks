import { useEffect, useRef, useState } from "react";

import type { BlockId } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";

/**
 * The block caption line: a centered single-line field BELOW the block
 * (outside the block's card). The caption text is the block's `caption`
 * attr (data — it syncs, survives a reload, and is in the undo history);
 * the empty string is the removed state (the attrs are never removed).
 *
 * The line stands while the caption is non-empty OR the line holds the
 * focus (a fresh line from the button press, before the first character);
 * an empty line loses the focus and unmounts (the last deletion already
 * wrote the empty string, so the blur itself issues no command).
 *
 * The button press (from the block's controls) seats the caret at the
 * last character — or does nothing when the line is already focused with
 * the caret at the end. The seating request is a one-shot flag (the store
 * re-renders on every keystroke and must never re-seat a mid-line caret).
 *
 * The live inputs are kept per EDITOR instance (the store scope): a
 * consumer can mount several editors over the same doc in one document
 * (the playground's two panes), and a button press must reach the input
 * of the pane it stands in.
 */

/** The caption inputs of one editor instance, keyed by the block id. */
interface CaptionEntry {
  input: () => HTMLInputElement | null;
  show: () => void;
}

/** The per-editor registries (the store instance is the scope; a WeakMap so the registries die with the editor). */
const captionRegistry = new WeakMap<object, Map<BlockId, CaptionEntry>>();

/** Show the caption line of the editor's block (if absent) and seat the caret at the last character. */
function requestBlockCaption(scope: object, id: BlockId): void {
  const entry = captionRegistry.get(scope)?.get(id);
  if (entry === undefined) return;
  const input = entry.input();
  if (input !== null && document.activeElement === input && input.selectionEnd === input.value.length) return;
  entry.show();
}

interface BlockCaptionProps {
  /** The block id (the caption's registry seat + the updateBlock target). */
  id: BlockId;
  /** The caption text (the block's `caption` attr; absent reads as empty). */
  caption: string;
  /** The line's data-slot (the block-kind hook, e.g. `docblocks/code-caption`). */
  slot: string;
  /** The line's aria label (the block-kind wording). */
  ariaLabel: string;
  /** The line's placeholder (the empty draft's hint). */
  placeholder: string;
}

function BlockCaption({ id, caption, slot, ariaLabel, placeholder }: BlockCaptionProps) {
  const { doc, store } = useEditorContext();
  const [local, setLocal] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const seatRef = useRef(false);

  useEffect(() => {
    let registry = captionRegistry.get(store);
    if (registry === undefined) {
      registry = new Map();
      captionRegistry.set(store, registry);
    }
    registry.set(id, {
      input: () => inputRef.current,
      show: () => {
        const input = inputRef.current;
        if (input === null) {
          // The fresh line: the flag is consumed by the effect of the
          // mount render (local was necessarily false — the line stands
          // only while non-empty or focused — so setLocal always renders).
          seatRef.current = true;
          setLocal(true);
        } else {
          // The already-mounted line seats immediately (a no-op
          // setLocal would not render, and a laggard flag would be
          // consumed by the next unrelated re-render).
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        }
      },
    });
    return () => {
      registry?.delete(id);
    };
  }, [id, store]);

  // A fresh line (the flag set by the button press, consumed here) seats
  // the caret at the last character. One-shot: the store re-renders on
  // every caption keystroke and must never re-seat a mid-line caret.
  useEffect(() => {
    if (!seatRef.current) return;
    seatRef.current = false;
    const input = inputRef.current;
    if (input === null) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });

  if (caption === "" && !local) return null;

  return (
    <input
      ref={inputRef}
      data-slot={slot}
      type="text"
      value={caption}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onChange={(event) => {
        const value = event.target.value;
        if (value === caption) return;
        doc.updateBlock(id, { caption: value });
      }}
      onFocus={() => setLocal(true)}
      onBlur={() => setLocal(false)}
      className="
        mx-auto my-1 block w-[90%] bg-transparent text-center text-[0.8125em] text-muted-foreground outline-none
        placeholder:text-muted-foreground/60
      "
    />
  );
}

export { BlockCaption, requestBlockCaption };
export type { BlockCaptionProps };
