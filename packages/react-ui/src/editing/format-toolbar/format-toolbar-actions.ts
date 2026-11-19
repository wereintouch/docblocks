/** The format toolbar's ACTIONS over the selection's target: the mark's
 * toggle (the cross-block's per-block segments), the alignment (set-only —
 * `updateBlock` never removes attrs, so "left" is how the default is
 * restored), the palette target's value mark (the pick's close stand —
 * the apply's commit / the no-op's confirm, the picker stands no
 * hanging), and the list-type menu's action (the `list` attr's update or
 * the type's change + the selection's re-seat over the remount). Every
 * action is doc command(s) inside one transaction (one undo step, one
 * wire update). The active stands: a mark is active when every run of the
 * range carries it; a swatch is active when the whole range is uniformly
 * marked with the value (a highlight without a value counts as the empty
 * value); the cross-block's stands over the range's uniform reads. */
import type { RefObject } from "react";

import type { Block, Doc, TextAlign } from "docblocks-core";

import { restoreSelectionIn } from "../block-commands";
import {
  alignOfBlock,
  applyAlignRange,
  applyMarkRange,
  applyValueMarkRange,
  clearMarkRange,
  rangeMarkAction,
  uniformAlignOfRange,
  uniformMarkValue,
  uniformMarkValueRange,
} from "../format-range";
import { type FormatMark, markToggleAction } from "../keyboard";
import { LIST_MENU_OPTIONS } from "./constants";
import type { PaletteTarget, ToolbarRange } from "./models";

interface FormatToolbarActions {
  doc: Doc;
  /** The toolbar's target (the single's range / the cross's block chain). */
  range: ToolbarRange;
  /** The single target's block (the guard's stand; the cross's branches short-circuit before its read). */
  single: Block;
  /** The palette's target (the text's `color` vs the background's `highlight`). */
  target: PaletteTarget;
  rootRef: RefObject<HTMLElement | null>;
  /** The palette's close (the pick's stand over the apply / the no-op). */
  onPaletteClose: () => void;
  /** The list menu's close (the option's pick's stand). */
  onListMenuClose: () => void;
}

function createFormatToolbarActions({
  doc,
  range,
  single,
  target,
  rootRef,
  onPaletteClose,
  onListMenuClose,
}: FormatToolbarActions) {
  /** Toggle a mark over the target (one undo step, one wire update). A cross-block range applies the mark actions over the range's per-block segments. */
  const onToggleMark = (mark: FormatMark): void => {
    if (range.kind === "cross") {
      if (rangeMarkAction(doc, range.cross, mark) === "unset") clearMarkRange(doc, range.cross, mark);
      else applyMarkRange(doc, range.cross, mark);
      return;
    }
    const action = markToggleAction(doc, range.blockId, range.from, range.to, mark);
    doc.transact(() => {
      if (action === "unset") doc.unsetMark(range.blockId, range.from, range.to, mark);
      else doc.setMark(range.blockId, range.from, range.to, { type: mark });
    });
  };

  /** Apply an alignment (set-only; the current one is a visible no-op). */
  const onAlign = (align: TextAlign): void => {
    if (range.kind === "cross") {
      if (uniformAlignOfRange(doc, range.cross) === align) return;
      applyAlignRange(doc, range.cross, align);
      return;
    }
    if (alignOfBlock(single) === align) return;
    doc.transact(() => {
      doc.updateBlock(range.blockId, { align });
    });
  };

  /** Apply the palette target's mark with the value (or clear it). */
  const onPaletteValue = (value: string | null): void => {
    onPaletteClose();
    if (range.kind === "cross") {
      const current = uniformMarkValueRange(doc, range.cross, target);
      if (current === value) return;
      if (value === null) clearMarkRange(doc, range.cross, target);
      else applyValueMarkRange(doc, range.cross, target, value);
      return;
    }
    const current = uniformMarkValue(single, range.from, range.to, target);
    if (current === value) return;
    doc.transact(() => {
      if (value === null) doc.unsetMark(range.blockId, range.from, range.to, target);
      else if (target === "color") doc.setMark(range.blockId, range.from, range.to, { type: "color", value });
      else doc.setMark(range.blockId, range.from, range.to, { type: "highlight", value });
    });
  };

  /**
   * The list-type menu's action (single-block targets only): a swap inside
   * a list is a `list` attr update; any other target is a type change (the
   * target's required attrs come from the option). "Text" stands for a
   * list item with a derived segment (the flat model: the segment
   * re-attaches to the paragraph as its nested content — nothing is lost,
   * the indent stands).
   */
  const onListOption = (option: (typeof LIST_MENU_OPTIONS)[number]["option"]): void => {
    onListMenuClose();
    if (range.kind !== "single") return;
    // A list-type swap or a type change remounts the block's subtree (the
    // wrapper tag swaps), so the DOM selection dies with it: the gesture's
    // range is re-seated on the rebuilt block (the content stands, so the
    // offsets remain valid).
    const seat: { from: number; to: number } = { from: range.from, to: range.to };
    // The gesture's own inner element: the motion view's exit clone keeps
    // this node connected while the remount adds the survivor, so the
    // re-seat must not mistake the clone for the target.
    const exclude =
      rootRef.current?.querySelector<HTMLElement>(
        `[data-block-id="${CSS.escape(range.blockId)}"][data-slot="docblocks/block-content"]`
      ) ?? null;
    if (option === "paragraph") {
      // A task's `checked` is dropped by the type change (the check state
      // is not carried into plain text).
      if (single.type !== "paragraph") doc.transact(() => doc.changeBlockType(range.blockId, "paragraph"));
      restoreSelectionIn(doc, range.blockId, seat.from, seat.to, rootRef.current ?? document, exclude);
      return;
    }
    if (option === "quote") {
      // A task's `checked` is a type-specific attr: the type change drops
      // it (the check state is not carried into a non-list type).
      if (single.type !== "quote") doc.transact(() => doc.changeBlockType(range.blockId, "quote"));
      restoreSelectionIn(doc, range.blockId, seat.from, seat.to, rootRef.current ?? document, exclude);
      return;
    }
    const currentList = single.type === "list-item" ? single.attrs.list : null;
    if (currentList === option) return;
    // A task converted away from the task kind loses its checked state
    // (back to the unchecked default — converting back yields a fresh
    // unchecked item). No mark is synthesized: the checked state renders
    // the block's composition at 30% opacity, never a strike.
    const isCheckedTask = single.type === "list-item" && single.attrs.list === "task" && single.attrs.checked === true;
    doc.transact(() => {
      if (single.type === "list-item") {
        if (isCheckedTask) {
          doc.updateBlock(range.blockId, { list: option, checked: false });
        } else {
          doc.updateBlock(range.blockId, { list: option });
        }
      } else {
        doc.changeBlockType(range.blockId, "list-item", { list: option });
      }
    });
    restoreSelectionIn(doc, range.blockId, seat.from, seat.to, rootRef.current ?? document, exclude);
  };

  // The mark's active stand: every run of the range carries the mark.
  const markActive = (mark: FormatMark): boolean =>
    range.kind === "cross"
      ? rangeMarkAction(doc, range.cross, mark) === "unset"
      : markToggleAction(doc, range.blockId, range.from, range.to, mark) === "unset";

  // The alignment's active stand (the uniform read over the cross's segments).
  const alignActive = (align: TextAlign): boolean =>
    range.kind === "cross" ? uniformAlignOfRange(doc, range.cross) === align : alignOfBlock(single) === align;

  // The swatch's active stand: the whole range is uniformly marked with
  // the value (the empty value's parity over the highlight).
  const paletteActive = (value: string | null): boolean =>
    range.kind === "cross"
      ? uniformMarkValueRange(doc, range.cross, target) === value
      : uniformMarkValue(single, range.from, range.to, target) === value;

  // The palette's current uniform value (a hex, null when no mark stands,
  // or "mixed"): the selected swatch's seat. "mixed" matches no swatch.
  const currentMarkValue =
    range.kind === "cross"
      ? uniformMarkValueRange(doc, range.cross, target)
      : uniformMarkValue(single, range.from, range.to, target);

  // The trigger's chip preview (the shared language — the canvas's stand):
  // the uniform hex fills the chip; the absent mark and the mixed range
  // stand the X (the no-uniform-color's stand).
  const chipValue = currentMarkValue !== null && currentMarkValue !== "mixed" ? currentMarkValue : null;

  return {
    onToggleMark,
    onAlign,
    onPaletteValue,
    onListOption,
    markActive,
    alignActive,
    paletteActive,
    currentMarkValue,
    chipValue,
  };
}

export { createFormatToolbarActions };
export type { FormatToolbarActions };
