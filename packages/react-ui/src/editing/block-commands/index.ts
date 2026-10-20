/**
 * Block-level gestures over the FLAT page model: Enter (split), Backspace
 * (merge), Tab (indent), Shift+Tab (outdent), the blocks-selection
 * removal, the trailing-paragraph stand, the segment move, and the
 * DOM-only focus/caret seats. The doc is the source of truth: a gesture
 * never writes the DOM back; the store rebuilds it, and the focus/caret
 * move is a DOM-only effect scheduled for the next frame.
 */
export * from "./utils";
