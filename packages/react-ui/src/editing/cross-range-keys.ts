import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import type { Doc, Selection, SelectionView, TextPoint } from "docblocks-core";

import { focusCaretIn } from "./block-commands";
import { extendRangeFocusEnd } from "./range-extend";
import { syncDomSelection } from "./selection-mapping";

/**
 * The cross-block text range's keydown operations; the range owns the keys.
 *
 * Shift+arrow / home / end move the selection's focus end (the browser
 * cannot extend a selection across a contenteditable boundary);
 * Delete / Backspace and a printable character replace the range as text
 * (the middle blocks vanish, the endpoints are trimmed; one undo step, one
 * wire update); Enter is a no-op (the split gesture needs a caret). Returns
 * true when the key was handled; false when it passes through to the
 * browser (Tab/Shift+Tab are consumed as no-ops — the block gesture needs a
 * collapsed caret and must not re-parent the anchor block; the arrows
 * collapse the range to a caret, and the selectionchange mapping then
 * updates the view). The horizontal shift arrows / home / end never reach
 * the browser (a native extension acts on the anchor's editable and would
 * retract the range); at the range's edge they stand as a suppressed
 * no-op. The vertical shift arrows pass through (the native within-block
 * extension is the browser's; the remap reconciles the view). `root`
 * scopes the gesture-time view sync (the
 * browser does not dispatch selectionchange for the re-based selection).
 */
function handleCrossRangeKey(
  doc: Doc,
  view: SelectionView,
  selection: Selection,
  root: HTMLElement,
  event: ReactKeyboardEvent<HTMLElement>
): boolean {
  if (selection.kind !== "text" || selection.to === null) return false;
  if (
    event.shiftKey &&
    (event.key === "ArrowRight" || event.key === "ArrowLeft" || event.key === "Home" || event.key === "End")
  ) {
    // The range owns the keys: the native extension would act on the
    // anchor's editable and retract the range, so the default is always
    // suppressed — at the range's edge the gesture stands as a no-op.
    const moved = extendRangeFocusEnd(doc, selection, event.key);
    event.preventDefault();
    if (moved) syncDomSelection(root, doc, view);
    return true;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    const result = doc.deleteTextRange(selection.from, selection.to);
    if (result === null) {
      view.set({ kind: "none" });
      // The whole range vanished (the doc may be empty now): nothing left
      // to seat the caret on — park the focus on the editor root so the
      // undo/redo hotkeys (bound to the root) still reach the doc.
      root.focus();
    } else {
      focusCaretIn(result.blockId, result.offset, root);
    }
    return true;
  }
  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
    event.preventDefault();
    return true;
  }
  if (event.key === "Tab") {
    // The block gesture (nest / outdent) needs a collapsed caret: over a
    // cross range it must not re-parent the anchor block — consume it.
    event.preventDefault();
    return true;
  }
  if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.nativeEvent.isComposing) {
    event.preventDefault();
    const from = selection.from;
    const to = selection.to; // narrowed by the guard above (a caret range reaches no key here)
    // The seam outlives the transact via a property (a closure-assigned
    // variable is not flow-narrowed past the call).
    const seam: { point: TextPoint | null } = { point: null };
    doc.transact(() => {
      const deleted = doc.deleteTextRange(from, to);
      // A fully deleted range has no seam to insert into: the character is
      // dropped (the v1 edge).
      if (deleted !== null) doc.insertText(deleted.blockId, deleted.offset, event.key);
      seam.point = deleted;
    });
    if (seam.point === null) {
      view.set({ kind: "none" });
      root.focus(); // the whole range vanished: park the focus on the root (undo reach)
    } else {
      focusCaretIn(seam.point.blockId, seam.point.offset + 1, root);
    }
    return true;
  }
  return false;
}

export { handleCrossRangeKey };
