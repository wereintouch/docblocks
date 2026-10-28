/**
 * Mark commands: setMark, unsetMark over a text range [from, to).
 *
 * Marks are the Y.Text's per-character attributes. An exclusive mark (`code`)
 * replaces every other mark on the range; a non-exclusive mark is applied only
 * to characters that carry no exclusive mark (the exclusive characters stand
 * untouched). Unsetting removes the named attribute over the range.
 */
import type * as Y from "yjs";

import { MARK_REGISTRY, validateMarkSet } from "@docblocks-core/schema";
import type { MarkName, MarkSet, MentionKind } from "@docblocks-core/schema";

import { InvalidMarkError, InvalidOperationError, InvalidRangeError, formatValidationErrors } from "../errors";
import { localTransact } from "../layout";
import { ALL_MARK_NAMES, exclusiveFreeSpans } from "../text-model";
import { contentTextLength, requireTextBlock } from "./text";

/** Mark input for setMark: one mark with its attributes. */
type MarkInput =
  | { type: "bold" | "italic" | "strike" | "underline" | "code" }
  | { type: "link"; href: string }
  | { type: "mention"; kind: MentionKind; id: string; label: string }
  | { type: "color"; value: string }
  | { type: "highlight"; value?: string };

/** The mark name and the single-mark set the input maps to. */
function markInputToMark(mark: MarkInput): { name: MarkName; markSet: MarkSet } {
  const kind = mark.type;
  switch (mark.type) {
    case "link":
      return { name: "link", markSet: { link: { href: mark.href } } };
    case "mention":
      return { name: "mention", markSet: { mention: { kind: mark.kind, id: mark.id, label: mark.label } } };
    case "color":
      return { name: "color", markSet: { color: { value: mark.value } } };
    case "highlight":
      return mark.value === undefined
        ? { name: "highlight", markSet: { highlight: {} } }
        : { name: "highlight", markSet: { highlight: { value: mark.value } } };
    case "bold":
      return { name: "bold", markSet: { bold: true } };
    case "italic":
      return { name: "italic", markSet: { italic: true } };
    case "strike":
      return { name: "strike", markSet: { strike: true } };
    case "underline":
      return { name: "underline", markSet: { underline: true } };
    case "code":
      return { name: "code", markSet: { code: true } };
  }
  // Unreachable via the typed API; a runtime-injected `mark.type` outside the
  // union must not slip through as `undefined`.
  throw new InvalidMarkError(`Unknown mark type "${String(kind)}".`);
}

/**
 * Applies `mark` to the range [from, to). `from === to` is a no-op; a code
 * block rejects marks.
 */
function setMark(ydoc: Y.Doc, blockId: string, from: number, to: number, mark: MarkInput): void {
  const { name, markSet } = markInputToMark(mark);
  // "paragraph" is the generic text-type reference; the code-block rule is
  // enforced separately below as an operation error.
  const markErrors = validateMarkSet("paragraph", markSet);
  if (markErrors.length > 0) {
    throw new InvalidMarkError(`Invalid mark for block "${blockId}": ${formatValidationErrors(markErrors)}`);
  }
  const { type, content } = requireTextBlock(ydoc, blockId);
  if (type === "code") {
    throw new InvalidOperationError(`Marks cannot be applied in a code block "${blockId}".`);
  }
  const total = contentTextLength(content);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from > to || to > total) {
    throw new InvalidRangeError(`Range must satisfy 0 <= from < to <= ${total} (got from=${from}, to=${to}).`);
  }
  if (from === to) return; // no-op

  const exclusive = MARK_REGISTRY[name].exclusive;
  const value = markSet[name];
  localTransact(ydoc, () => {
    if (exclusive) {
      // An exclusive mark replaces every other mark on the range: the other
      // names stand null (drop them) and the mark itself is set.
      const clear: Record<string, unknown> = {};
      for (const other of ALL_MARK_NAMES) if (other !== name) clear[other] = null;
      content.format(from, to, { ...clear, [name]: value });
    } else {
      // A non-exclusive mark skips characters that carry an exclusive mark.
      for (const span of exclusiveFreeSpans(content, from, to)) {
        content.format(span.start, span.length, { [name]: value });
      }
    }
  });
}

/** Removes `name` from the marks of the characters in [from, to); other marks stay. */
function unsetMark(ydoc: Y.Doc, blockId: string, from: number, to: number, name: MarkName): void {
  if (!(name in MARK_REGISTRY)) {
    throw new InvalidMarkError(`Unknown mark "${String(name)}".`);
  }
  const { content } = requireTextBlock(ydoc, blockId);
  const total = contentTextLength(content);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from > to || to > total) {
    throw new InvalidRangeError(`Range must satisfy 0 <= from < to <= ${total} (got from=${from}, to=${to}).`);
  }
  if (from === to) return; // no-op

  localTransact(ydoc, () => {
    // Setting the attribute to null drops it (Yjs has no `unformat`).
    content.format(from, to, { [name]: null });
  });
}

export { markInputToMark, setMark, unsetMark };
export type { MarkInput };
