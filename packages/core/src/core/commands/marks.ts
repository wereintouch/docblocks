/**
 * Mark commands: setMark, unsetMark over a text range [from, to).
 *
 * Runs are split at the range edges and fully covered runs are updated in
 * place. A run that carries an exclusive mark is left untouched when a
 * non-exclusive mark is applied; applying an exclusive mark replaces the
 * run's marks entirely.
 */
import * as Y from "yjs";

import { MARK_REGISTRY, validateMarkSet } from "@docblocks-core/schema";
import type { MarkName, MarkSet, MentionKind } from "@docblocks-core/schema";

import { InvalidMarkError, InvalidOperationError, InvalidRangeError, formatValidationErrors } from "../errors";
import { localTransact } from "../layout";
import { contentTextLength, requireTextBlock, splitRunAt } from "./text";

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

/** Writes the mark value into a stored marks Y.Map. */
function writeMarkValue(marksMap: Y.Map<unknown>, name: MarkName, value: MarkSet[MarkName]): void {
  if (value === true) {
    marksMap.set(name, true);
    return;
  }
  if (value !== undefined && typeof value === "object") {
    const nested = new Y.Map<unknown>();
    for (const [key, attrValue] of Object.entries(value)) {
      if (attrValue !== undefined) nested.set(key, attrValue);
    }
    marksMap.set(name, nested);
  }
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

  localTransact(ydoc, () => {
    splitRunAt(content, from);
    splitRunAt(content, to);
    const exclusive = MARK_REGISTRY[name].exclusive;
    const value = markSet[name];
    let offset = 0;
    content.forEach((entry) => {
      if (!(entry instanceof Y.Map)) return;
      const text = entry.get("text");
      if (!(text instanceof Y.Text)) return;
      const start = offset;
      offset += text.length;
      if (text.length === 0 || start < from || start + text.length > to) return; // not fully covered
      const marksMap = entry.get("marks");
      if (!(marksMap instanceof Y.Map)) return;
      const carriesExclusive = [...marksMap.keys()].some((key) => MARK_REGISTRY[key as MarkName]?.exclusive);
      if (carriesExclusive && !exclusive) return; // never mark over an exclusive run
      if (exclusive) {
        for (const key of [...marksMap.keys()]) marksMap.delete(key);
      }
      writeMarkValue(marksMap, name, value);
    });
  });
}

/** Removes `name` from the marks of the runs in [from, to); other marks stay. */
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
    splitRunAt(content, from);
    splitRunAt(content, to);
    let offset = 0;
    content.forEach((entry) => {
      if (!(entry instanceof Y.Map)) return;
      const text = entry.get("text");
      if (!(text instanceof Y.Text)) return;
      const start = offset;
      offset += text.length;
      if (text.length === 0 || start < from || start + text.length > to) return; // not fully covered
      const marksMap = entry.get("marks");
      if (marksMap instanceof Y.Map) marksMap.delete(name);
    });
  });
}

export { markInputToMark, setMark, unsetMark };
export type { MarkInput };
